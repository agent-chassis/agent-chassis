import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { readWorkRecordById, writeValidatedWorkRecord } from "./work-records-store-io.mjs";
import { withWorkRecordWriteLock } from "./work-record-write-lock.mjs";
import { captureWorkRecordEntryContent, decodeWorkRecordEntryReference,
  decodeWorkRecordTextReference, encodeWorkRecordEntryReference,
  resolveWorkRecordEntryContent, resolveWorkRecordEntryVersionLengths } from "../lib/work-record-entry-content.mjs";
import { WORK_RECORD_AMBIGUITY_DEFAULT_CHOICES,
  WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT, WORK_RECORD_ENTRY_METADATA_PAGE_MAX,
  WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES, WORK_RECORD_TEXT_PAGE_MAX_SCALARS, checkedAdd, validateWorkRecordEntryKind,
  validateWorkRecordEntryTitle, validateSelectionLiteral,
  validateWorkRecordEntryContent } from "../lib/work-record-entry-schema.mjs";
import { fitReadPagePopulation } from "../lib/work-record-read-page-budget.mjs";
import { isWorkRecordFreshness, projectWorkRecordFreshness,
  workRecordFreshnessMatches } from "../lib/work-record-schema-constants.mjs";

const READ_TOOL = "workspace_work_record_entry_read";
const CHOICE_PREFIX = "wkchoice.v2";
const CANONICAL_DECIMAL = /^(0|[1-9][0-9]*)$/u;
const diagnostic = (code, message, pathValue = null) => ({ code, severity:"error",
  authority_limb:"mechanical", message, ...(pathValue === null ? {} : { path:pathValue }) });
const refusal = (code, message, pathValue = null, extra = {}) => ({ ok:false, valid:false,
  written:false, diagnostics:[diagnostic(code,message,pathValue)], ...extra });
function parseUnit(unit) { const match=/^(WK-[0-9]{4,})(?:#(SLICE-[0-9]{3,}))?$/u.exec(unit??"");
  return match?{id:match[1],slice:match[2]??null,address:unit}:null; }
function selectUnit(record, parsed) { return parsed.slice===null?record:record.slices?.find(value=>value.id===parsed.slice); }
function nextId(values,field,code){let max=0;for(const value of values){if(!Number.isSafeInteger(value?.[field])||value[field]<=0)return{issue:diagnostic(code,"retained identity is invalid")};max=Math.max(max,value[field]);}const next=checkedAdd(max,1);return next===null?{issue:diagnostic(code,"retained identity arithmetic overflow")}:{value:next};}

function entryRef(repository,record,parsed,entry,version,lengths=version,offset=0,length=lengths.scalar_length){return encodeWorkRecordEntryReference({repository,recordId:record.id,sliceId:parsed.slice,entryId:entry.id,versionId:version.id,offset,length,total:lengths.scalar_length});}
const lengthRefusal=(loaded,lengths)=>({ok:false,valid:false,written:false,source_digest:loaded.source_digest,diagnostics:[lengths.diagnostic]});
const readCall=args=>({tool:READ_TOOL,arguments:args});

function bodyArguments({repository,unit,entryId,version,offset=0,length,expectedSourceDigest}){
  return {...(repository===null?{}:{repo:repository}),unit,entry_id:entryId,...(version===undefined?{}:{version}),include_body:true,
    ...(offset>0?{offset}:{}),...(length===undefined?{}:{length}),
    ...(expectedSourceDigest===undefined?{}:{expected_source_digest:expectedSourceDigest})};
}

export function buildWorkRecordEntryBodyReadCall({repository,unit,entryId,version,offset,length,expectedSourceDigest}={}) {
  if(typeof repository!=="string"||repository.length===0)throw new TypeError("repository must be a nonempty string");
  if(!parseUnit(unit))throw new TypeError("unit must be WK-#### or WK-#####SLICE-###");
  if(!Number.isSafeInteger(entryId)||entryId<=0)throw new TypeError("entryId must be a positive safe integer");
  if(!Number.isSafeInteger(version)||version<=0)throw new TypeError("version must be a positive safe integer");
  const pageOffset=offset??0;
  if(!Number.isSafeInteger(pageOffset)||pageOffset<0)throw new TypeError("offset must be a nonnegative safe integer");
  if(length!==undefined&&(!Number.isSafeInteger(length)||length<=0)){
    throw new TypeError("length must be a positive safe integer");
  }
  if(checkedAdd(pageOffset,length??0)===null)throw new TypeError("entry body range exceeds safe integer arithmetic");
  if(expectedSourceDigest!==undefined&&(typeof expectedSourceDigest!=="string"||expectedSourceDigest.length===0)){
    throw new TypeError("expectedSourceDigest must be a nonempty string when supplied");
  }
  return readCall(bodyArguments({repository,unit,entryId,version,offset:pageOffset,length,expectedSourceDigest}));
}

function choiceChecksum(repository,unit,slots){
  return createHash("sha256").update(JSON.stringify([CHOICE_PREFIX,repository,unit,...slots]),"utf8").digest("base64url");
}
function encodeChoice(repository,unit,{entry,version,literalStart,literalLength,choiceOffset,occurrence}){
  const slots=[entry,version,literalStart,literalLength,choiceOffset,occurrence];
  return `${CHOICE_PREFIX}.${entry}.${version}.${literalStart}.${literalLength}.${choiceOffset}.${occurrence===null?"-":occurrence}.${choiceChecksum(repository,unit,slots)}`;
}
function decodeChoice(repository,unit,value){
  if(typeof value!=="string")return null;
  const parts=value.split(".");
  if(parts.length!==9||`${parts[0]}.${parts[1]}`!==CHOICE_PREFIX)return null;
  const slots=[];
  for(const [index,text] of parts.slice(2,8).entries()){
    if(index===5&&text==="-"){slots.push(null);continue;}
    if(!CANONICAL_DECIMAL.test(text)||!Number.isSafeInteger(Number(text)))return null;
    slots.push(Number(text));
  }
  const [entry,version,literalStart,literalLength,choiceOffset,occurrence]=slots;
  if(entry<=0||version<=0||literalLength<=0||(occurrence!==null&&choiceOffset!==0))return null;
  if(!/^[A-Za-z0-9_-]{43}$/u.test(parts[8])||
      !timingSafeEqual(Buffer.from(parts[8]),Buffer.from(choiceChecksum(repository,unit,slots))))return null;
  return {entry,version,literalStart,literalLength,choiceOffset,occurrence};
}

function compactWriteSuccess(write, fields) {
  const result = {};
  for (const key of ["ok", "valid", "written", "no_op", "publication_state", "record_id",
    "selected_unit", "source_digest", "current_source_digest", "diagnostics"]) {
    if (Object.hasOwn(write, key)) result[key] = write[key];
  }
  return { ...result, ...fields };
}

async function scanEntrySelection({content,repository,dir,loadWorkRecord,literal,
  occurrence,choiceOffset=0}) {
  const literalPoints=Array.from(literal);
  const prefix=new Array(literalPoints.length).fill(0);
  for(let index=1,matched=0;index<literalPoints.length;index+=1){
    while(matched>0&&literalPoints[index]!==literalPoints[matched])matched=prefix[matched-1];
    if(literalPoints[index]===literalPoints[matched])matched+=1;
    prefix[index]=matched;
  }
  const entryResolutionState={active:new Set(),memo:new Map(),sourceCache:new Map()};
  const measured=await resolveWorkRecordEntryContent({content,repository,dir,
    loadWorkRecordById:loadWorkRecord,entryResolutionState,materialize:false,offset:0,length:0});
  if(!measured.ok)return measured;
  let matched=0,totalCount=0,selectedOffset=null;
  const choices=[];
  for(let pageOffset=0;pageOffset<measured.scalar_length;pageOffset+=WORK_RECORD_TEXT_PAGE_MAX_SCALARS){
    const pageLength=Math.min(WORK_RECORD_TEXT_PAGE_MAX_SCALARS,measured.scalar_length-pageOffset);
    const page=await resolveWorkRecordEntryContent({content,repository,dir,
      loadWorkRecordById:loadWorkRecord,entryResolutionState,offset:pageOffset,length:pageLength});
    if(!page.ok)return page;
    const points=Array.from(page.value);
    for(let index=0;index<points.length;index+=1){
      while(matched>0&&points[index]!==literalPoints[matched])matched=prefix[matched-1];
      if(points[index]===literalPoints[matched])matched+=1;
      if(matched!==literalPoints.length)continue;
      const matchOffset=pageOffset+index-literalPoints.length+1;
      if(totalCount===occurrence)selectedOffset=matchOffset;
      if(totalCount>=choiceOffset&&choices.length<WORK_RECORD_AMBIGUITY_DEFAULT_CHOICES){
        choices.push(matchOffset);
      }
      totalCount+=1;
      matched=prefix[matched-1];
    }
    if(occurrence!==undefined&&selectedOffset!==null)break;
  }
  return {ok:true,scalar_length:measured.scalar_length,utf8_bytes:measured.utf8_bytes,
    literal_length:literalPoints.length,total_count:totalCount,selected_offset:selectedOffset,choices};
}

export async function upsertWorkRecordEntry({dir=".",repository,unit,entryId,title,kind,content,
  expectedSourceDigest,writeWorkRecord=writeValidatedWorkRecord,loadWorkRecord=readWorkRecordById,
  resolveExternalReference=null}={}){
  const parsed=parseUnit(unit);if(!parsed)return refusal("work_record_entry_unit_invalid","unit must be WK-#### or WK-####\u0023SLICE-###","unit");
  if(typeof expectedSourceDigest!=="string"||expectedSourceDigest.length===0)return refusal("invalid_expected_source_digest","expected_source_digest is required","expected_source_digest");
  const creating=entryId===undefined;
  if(!creating&&(!Number.isSafeInteger(entryId)||entryId<=0))return refusal("work_record_entry_id_invalid","entry_id must be a positive safe integer","entry_id");
  if(creating&&title===undefined)return refusal("work_record_entry_title_invalid","create requires title","title");
  if(creating&&content===undefined)return refusal("work_record_entry_content_missing","create requires content","content");
  for(const issue of [validateWorkRecordEntryTitle(title,{required:creating}),
    validateWorkRecordEntryKind(kind)])if(issue)return{ok:false,valid:false,written:false,diagnostics:[issue]};
  if(content===null)return refusal("work_record_entry_content_invalid","content must not be null","content");
  if(content!==undefined){const shape=validateWorkRecordEntryContent(content,{path:"content"});if(!shape.ok)return{ok:false,valid:false,written:false,diagnostics:[shape.diagnostic]};}
  const targetDir=path.resolve(String(dir));
  const externalCaptures=new Map();
  if(content!==undefined&&typeof resolveExternalReference==="function"){
    const leaves=Array.isArray(content.parts)?content.parts:[content];
    for(const leaf of leaves){
      if(typeof leaf?.ref!=="string")continue;
      const retained=decodeWorkRecordEntryReference(leaf.ref);
      const ordinary=retained===null?decodeWorkRecordTextReference(leaf.ref):null;
      if(retained!==null||ordinary?.ok)continue;
      const external=await resolveExternalReference({reference:leaf.ref,repository});
      if(external?.ok!==true)return refusal(`work_record_external_reference_${external?.state??"unavailable"}`,`external reference source is ${external?.state??"unavailable"}`,"content");
      externalCaptures.set(leaf.ref,external);
    }
  }
  return withWorkRecordWriteLock(targetDir,async()=>{
    const loaded=await loadWorkRecord({dir:targetDir,id:parsed.id});
    if(!loaded?.valid||!loaded.record){
      if(Array.isArray(loaded?.diagnostics)&&loaded.diagnostics.length>0)return{...loaded,ok:false,valid:false,written:false};
      return refusal("work_record_entry_target_missing","target work record is unavailable","unit");
    }
    if(loaded.source_digest!==expectedSourceDigest)return refusal("stale_source_digest","source digest does not match the current canonical record","expected_source_digest",{expected_source_digest:expectedSourceDigest,current_source_digest:loaded.source_digest,source_digest:loaded.source_digest,next_calls:[{tool:READ_TOOL,arguments:{repo:repository,unit},recommended:true}]});
    const record=structuredClone(loaded.record),owner=selectUnit(record,parsed);
    if(!owner)return refusal("work_record_entry_unit_missing","selected unit is unavailable","unit");
    owner.sections??={};owner.sections.entries??=[];
    const entry=creating?null:owner.sections.entries.find(value=>value.id===entryId);
    if(!creating&&!entry)return refusal("work_record_entry_missing","entry_id is not owned by the selected unit","entry_id");
    const current=entry?.versions.find(value=>value.id===entry.current_version)??null;
    if(!creating&&!current)return refusal("work_record_entry_history_corrupt","current version is not retained","entry_id");
    const currentLengths=creating?null:await resolveWorkRecordEntryVersionLengths({entry,version:current,repository,dir:targetDir,loadWorkRecordById:loadWorkRecord});
    if(currentLengths&&!currentLengths.ok)return lengthRefusal(loaded,currentLengths);
    const intendedTitle=title===undefined?current?.title:title,intendedKind=kind===undefined?(current?.kind??""):kind,intendedContent=content===undefined?structuredClone(current?.content):content;
    if(!creating&&JSON.stringify({title:intendedTitle,kind:intendedKind,content:intendedContent})===JSON.stringify({title:current.title,kind:current.kind,content:current.content}))return compactWriteSuccess({ok:true,valid:true,written:false,no_op:true,publication_state:"not_published",record_id:record.id,source_digest:loaded.source_digest,current_source_digest:loaded.source_digest,diagnostics:[]},{entry_id:entry.id,version_id:current.id,reference:entryRef(repository,record,parsed,entry,current,currentLengths)});
    const lockedExternalResolver=externalCaptures.size===0?null:async({reference,repository:sourceRepository})=>{
      const original=externalCaptures.get(reference);
      if(!original)return{ok:false,state:"corrupt"};
      const currentSource=await resolveExternalReference({reference,repository:sourceRepository});
      if(currentSource?.ok!==true)return currentSource;
      if(currentSource.text!==original.text||
          JSON.stringify(currentSource.provenance)!==JSON.stringify(original.provenance)){
        return{ok:false,state:"changed"};
      }
      return original;
    };

    const captured=await captureWorkRecordEntryContent({content:intendedContent,repository,dir:targetDir,loadWorkRecordById:loadWorkRecord,resolveExternalReference:lockedExternalResolver});
    if(captured.ok&&content===undefined)captured.provenance=structuredClone(current.provenance);
    if(!captured.ok)return{ok:false,valid:false,written:false,source_digest:loaded.source_digest,diagnostics:[captured.diagnostic]};
    if(creating&&captured.scalar_length===0)return refusal("work_record_entry_content_empty","create content must resolve to at least one Unicode scalar","content",{source_digest:loaded.source_digest});
    let targetEntry=entry;
    if(creating){const all=[record,...(record.slices??[])].flatMap(value=>value.sections?.entries??[]),allocation=nextId(all,"id","work_record_entry_identity_overflow");if(allocation.issue)return{ok:false,valid:false,written:false,diagnostics:[allocation.issue]};targetEntry={id:allocation.value,current_version:1,versions:[]};owner.sections.entries.push(targetEntry);}
    const versionAllocation=creating?{value:1}:nextId(targetEntry.versions,"id","work_record_entry_version_identity_overflow");if(versionAllocation.issue)return{ok:false,valid:false,written:false,diagnostics:[versionAllocation.issue]};
    const versionValue={id:versionAllocation.value,title:intendedTitle,kind:intendedKind,content:structuredClone(captured.content),scalar_length:captured.scalar_length,utf8_bytes:captured.utf8_bytes,provenance:structuredClone(captured.provenance)};
    targetEntry.versions.push(versionValue);targetEntry.current_version=versionValue.id;record.updated=new Date().toISOString().slice(0,10);
    const write=await writeWorkRecord({dir:targetDir,record,expectedSourceDigest:loaded.source_digest,lockAlreadyHeld:true});
    const identity={entry_id:targetEntry.id,version_id:versionValue.id,reference:entryRef(repository,record,parsed,targetEntry,versionValue)};
    if(write?.ok===true)return compactWriteSuccess(write,identity);
    return {...write,...identity,next_calls:[{tool:READ_TOOL,arguments:{repo:repository,unit,entry_id:targetEntry.id,view:"history"},recommended:true}]};
  });
}

const READ_BRANCH_FIELDS = Object.freeze(["entryId","version","view","includeBody","referenceOnly",
  "offset","length","limit","expectedSourceDigest","selection","continuation"]);

function readBranch(selectors) {
  if (selectors.continuation !== undefined) return { name:"choice", allowed:["continuation"] };
  if (selectors.entryId === undefined) return { name:"entries", allowed:["limit","offset","expectedSourceDigest"] };
  if (selectors.view !== undefined) return { name:"history", allowed:["entryId","view","limit","offset","expectedSourceDigest"] };
  if (selectors.includeBody !== undefined) return { name:"body", allowed:["entryId","includeBody","version","offset","length","expectedSourceDigest"] };
  if (selectors.referenceOnly !== undefined) return { name:"reference", allowed:["entryId","referenceOnly","version","offset","length"] };
  if (selectors.selection !== undefined) return { name:"selection", allowed:["entryId","selection","version"] };
  return { name:"metadata", allowed:["entryId","version"] };
}

function selectorIssue(selectors, branch) {
  const invalid=(message,pathValue)=>refusal("work_record_entry_selector_invalid",message,pathValue);
  const extra=READ_BRANCH_FIELDS.find(field=>selectors[field]!==undefined&&!branch.allowed.includes(field));
  if(extra)return invalid(`${extra} is not accepted by the selected entry read`,extra);
  const positive=value=>value===undefined||(Number.isSafeInteger(value)&&value>0);
  const nonnegative=value=>value===undefined||(Number.isSafeInteger(value)&&value>=0);
  if(!positive(selectors.entryId))return invalid("entry_id must be a positive safe integer","entry_id");
  if(!positive(selectors.version))return invalid("version must be a positive safe integer","version");
  if(!nonnegative(selectors.offset))return invalid("offset must be a nonnegative safe integer","offset");

  if(!positive(selectors.length))return invalid("length must be a positive safe integer","length");
  if(selectors.expectedSourceDigest!==undefined&&!isWorkRecordFreshness(selectors.expectedSourceDigest))return invalid(
    "expected_source_digest must be the 16-hex source_digest a read returned","expected_source_digest");
  if(!positive(selectors.limit)||selectors.limit>WORK_RECORD_ENTRY_METADATA_PAGE_MAX)return invalid(
    `limit must be between 1 and ${WORK_RECORD_ENTRY_METADATA_PAGE_MAX}`,"limit");
  if(selectors.view!==undefined&&selectors.view!=="history")return invalid("view must be \"history\"","view");
  if((branch.name==="entries"||branch.name==="history")&&selectors.offset>0&&selectors.expectedSourceDigest===undefined){
    return invalid("a later metadata page requires expected_source_digest","expected_source_digest");
  }
  if(branch.name==="body"&&selectors.offset>0&&selectors.version===undefined){
    return invalid("a later body page requires its immutable version","version");
  }
  return null;
}

export async function readWorkRecordEntry({dir=".",repository,unit,entryId,version,view,
  includeBody=false,referenceOnly=false,offset,length,limit,expectedSourceDigest,selection,continuation,
  loadWorkRecord=readWorkRecordById,callRepository=repository}={}){

  const callRepo=callRepository===null?{}:{repo:callRepository};
  const parsed=parseUnit(unit);
  if(!parsed)return refusal("work_record_entry_unit_invalid","unit must be WK-#### or WK-#####SLICE-###","unit");
  const selectors={entryId,version,view,includeBody:includeBody===true?true:undefined,
    referenceOnly:referenceOnly===true?true:undefined,offset,length,limit,expectedSourceDigest,selection,continuation};
  const branch=readBranch(selectors);
  const issue=selectorIssue(selectors,branch);
  if(issue)return issue;
  let choice=null;
  if(branch.name==="choice"){
    choice=decodeChoice(repository,unit,continuation);
    if(!choice)return refusal("work_record_entry_continuation_invalid",
      "continuation is not an intact wkchoice.v2 call for this repository and unit","continuation");
    ({entry:entryId,version}=choice);
  }
  const loaded=await loadWorkRecord({dir,id:parsed.id});
  if(!loaded?.valid||!loaded.record){
    if(Array.isArray(loaded?.diagnostics)&&loaded.diagnostics.length>0)return{ok:false,valid:false,written:false,
      source_digest:projectWorkRecordFreshness(loaded.source_digest),diagnostics:loaded.diagnostics};
    return refusal("work_record_entry_target_missing","target record is unavailable","unit");
  }
  const owner=selectUnit(loaded.record,parsed);
  if(!owner)return refusal("work_record_entry_unit_missing","selected unit is unavailable","unit");
  const entries=owner.sections?.entries??[];

  const sourceDigest=projectWorkRecordFreshness(loaded.source_digest);
  const stale=expectedSourceDigest!==undefined&&!workRecordFreshnessMatches(expectedSourceDigest,loaded.source_digest);

  if(branch.name==="body"&&stale){
    return refusal("stale_source_digest","canonical generation changed since the pinned body page","expected_source_digest",
      {expected_source_digest:expectedSourceDigest,current_source_digest:sourceDigest,
        next_calls:[readCall(bodyArguments({repository:callRepository,unit,entryId,version,offset,length}))]});
  }
  const listLimit=limit??WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT;
  const pageArguments=(fields,end)=>({...callRepo,unit,...fields,offset:end,
    ...(listLimit!==WORK_RECORD_ENTRY_METADATA_PAGE_DEFAULT?{limit:listLimit}:{}),expected_source_digest:sourceDigest});
  const metadataPage=({fields,population,row,key})=>{
    const fresh={...callRepo,unit,...fields};
    if(stale)return refusal("stale_source_digest",
      "canonical generation changed during metadata paging","expected_source_digest",
      {expected_source_digest:expectedSourceDigest,current_source_digest:sourceDigest,next_calls:[readCall(fresh)]});
    const start=offset??0;
    if(start>population.length)return refusal("work_record_entry_range_invalid",
      "offset is past the end of the metadata population","offset",{source_digest:sourceDigest});
    const build=count=>{
      const rows=population.slice(start,start+count).map(row);
      const end=start+rows.length;
      return {ok:true,...(fields.entry_id===undefined?{}:{entry_id:fields.entry_id}),source_digest:sourceDigest,
        offset:start,total_count:population.length,[key]:rows,
        next_calls:end<population.length?[readCall(pageArguments(fields,end))]:[]};
    };
    return fitReadPagePopulation(Math.min(listLimit,population.length-start),build,WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES);
  };

  if(branch.name==="entries"){
    return metadataPage({fields:{},population:entries,key:"entries",row:retained=>{
      const current=retained.versions.find(value=>value.id===retained.current_version);
      return {entry_id:retained.id,version_id:current.id,title:current.title,kind:current.kind,
        next_call:readCall(bodyArguments({repository:callRepository,unit,entryId:retained.id,version:current.id}))};
    }});
  }

  const entry=entries.find(value=>value.id===entryId);
  if(!entry)return refusal("work_record_entry_missing","entry_id is not owned by the selected unit","entry_id",{source_digest:sourceDigest});
  if(branch.name==="history"){
    return metadataPage({fields:{entry_id:entry.id,view:"history"},population:entry.versions,key:"versions",
      row:value=>({version_id:value.id,title:value.title,kind:value.kind,
        next_call:readCall(bodyArguments({repository:callRepository,unit,entryId:entry.id,version:value.id}))})});
  }

  const selectedVersion=entry.versions.find(value=>value.id===(version??entry.current_version));
  if(!selectedVersion)return refusal("work_record_entry_version_missing","selected immutable version is not retained","version",{source_digest:sourceDigest});
  const lengths=await resolveWorkRecordEntryVersionLengths({entry,version:selectedVersion,repository,dir,
    loadWorkRecordById:loadWorkRecord});
  if(!lengths.ok)return lengthRefusal(loaded,lengths);
  const total=lengths.scalar_length;
  const identity={entry_id:entry.id,version_id:selectedVersion.id};
  const rangeRefusal=()=>refusal("work_record_entry_range_invalid",
    "requested range is outside the immutable version","offset",{source_digest:sourceDigest});
  const resolveRange=(start,span)=>resolveWorkRecordEntryContent({content:selectedVersion.content,repository,dir,
    loadWorkRecordById:loadWorkRecord,offset:start,length:span});
  const resolutionRefusal=resolved=>({ok:false,valid:false,written:false,source_digest:sourceDigest,diagnostics:[resolved.diagnostic]});
  const lengthsMismatch=resolved=>resolved.scalar_length!==total||resolved.utf8_bytes!==lengths.utf8_bytes;
  const corruptRefusal=()=>refusal("work_record_entry_history_corrupt",
    "immutable version length metadata does not match rendered content","entry_id",{source_digest:sourceDigest});

  if(branch.name==="metadata"){
    return {ok:true,...identity,source_digest:sourceDigest,title:selectedVersion.title,kind:selectedVersion.kind,
      scalar_length:total,utf8_bytes:lengths.utf8_bytes,next_calls:[
        readCall(bodyArguments({repository:callRepository,unit,entryId:entry.id,version:selectedVersion.id})),
        readCall({...callRepo,unit,entry_id:entry.id,version:selectedVersion.id,reference_only:true}),
        readCall({...callRepo,unit,entry_id:entry.id,view:"history"})]};
  }

  if(branch.name==="reference"){
    const start=offset??0;
    const span=length??(total-start);
    if(start>total||checkedAdd(start,span)===null||start+span>total)return rangeRefusal();
    return {ok:true,...identity,source_digest:sourceDigest,
      reference:entryRef(repository,loaded.record,parsed,entry,selectedVersion,lengths,start,span)};
  }

  if(branch.name==="body"){
    const start=offset??0;
    if(start>total)return rangeRefusal();

    const span=length===undefined?total-start:Math.min(length,total-start);

    const resolved=await resolveRange(start,span);
    if(!resolved.ok)return resolutionRefusal(resolved);
    if(lengthsMismatch(resolved))return corruptRefusal();
    const end=start+span;
    return {ok:true,...identity,source_digest:sourceDigest,
      body:{value:resolved.value,offset:start,length:span,total},
      next_calls:end<total?[readCall(bodyArguments({repository:callRepository,unit,entryId:entry.id,version:selectedVersion.id,
        offset:end,length,expectedSourceDigest:sourceDigest}))]:[]};
  }

  let literal=selection?.text;
  if(choice){
    if(checkedAdd(choice.literalStart,choice.literalLength)===null||choice.literalStart+choice.literalLength>total){
      return refusal("work_record_entry_continuation_invalid","choice literal extent is outside the immutable version","continuation",{source_digest:sourceDigest});
    }
    const located=await resolveRange(choice.literalStart,choice.literalLength);
    if(!located.ok)return resolutionRefusal(located);
    literal=located.value;
  }
  const literalIssue=validateSelectionLiteral(literal);
  if(literalIssue)return{ok:false,valid:false,written:false,source_digest:sourceDigest,diagnostics:[literalIssue]};
  const choiceOffset=choice?.occurrence===null?choice.choiceOffset:0;
  const occurrence=choice?.occurrence??undefined;
  const data=await scanEntrySelection({content:selectedVersion.content,repository,dir,
    loadWorkRecord,literal,occurrence,choiceOffset});
  if(!data.ok)return resolutionRefusal(data);
  if(data.scalar_length!==total||data.utf8_bytes!==lengths.utf8_bytes)return corruptRefusal();
  if(data.total_count===0)return refusal("work_record_entry_selection_no_match",
    "selection text does not occur in this version","selection.text",{source_digest:sourceDigest,...identity,selection:{state:"no_match"}});
  if(occurrence===undefined&&data.total_count>1){
    if(data.choices.length===0)return refusal("work_record_entry_continuation_invalid",
      "choice offset is past the last occurrence","continuation",{source_digest:sourceDigest});
    const choiceCall=fields=>readCall({...callRepo,unit,continuation:encodeChoice(repository,unit,
      {entry:entry.id,version:selectedVersion.id,literalLength:data.literal_length,...fields})});
    const build=count=>{
      const choices=data.choices.slice(0,count).map((matchOffset,index)=>({occurrence:choiceOffset+index,
        offset:matchOffset,length:data.literal_length,
        next_call:choiceCall({literalStart:matchOffset,choiceOffset:0,occurrence:choiceOffset+index})}));
      const end=choiceOffset+choices.length;
      return refusal("work_record_entry_selection_ambiguous",`selection has ${data.total_count} overlapping matches`,
        "selection.text",{...identity,selection:{state:"ambiguous",total_count:data.total_count,offset:choiceOffset,choices},
          next_calls:end<data.total_count?[choiceCall({literalStart:data.choices[0],choiceOffset:end,occurrence:null})]:[]});
    };
    return fitReadPagePopulation(data.choices.length,build,WORK_RECORD_ENTRY_READ_TARGET_UTF8_BYTES);
  }
  const matchOffset=occurrence===undefined?data.choices[0]:data.selected_offset;
  if(matchOffset===undefined||matchOffset===null)return refusal("work_record_entry_selection_occurrence_invalid",
    "selected occurrence is unavailable","continuation",{source_digest:sourceDigest});
  const matchLength=data.literal_length,after=matchOffset+matchLength;
  return {ok:true,...identity,selection:{state:"unique",occurrence:occurrence??0,offset:matchOffset,length:matchLength,
    before_ref:entryRef(repository,loaded.record,parsed,entry,selectedVersion,lengths,0,matchOffset),
    match_ref:entryRef(repository,loaded.record,parsed,entry,selectedVersion,lengths,matchOffset,matchLength),
    after_ref:entryRef(repository,loaded.record,parsed,entry,selectedVersion,lengths,after,total-after)},next_calls:[]};
}
