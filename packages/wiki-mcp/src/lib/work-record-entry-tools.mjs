import { readWorkRecordEntry, upsertWorkRecordEntry } from "@agent-chassis/wiki-core";
import { WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES, WORK_RECORD_ENTRY_METADATA_PAGE_MAX,
  WORK_RECORD_SELECTION_MAX_UTF8_BYTES, isUnicodeScalarString } from "@agent-chassis/wiki-core/src/lib/work-record-entry-schema.mjs";
import { WORK_RECORD_FRESHNESS_PATTERN } from "@agent-chassis/wiki-core/src/lib/work-record-schema-constants.mjs";
import { MCP_WRITE_SEMANTICS } from "./register-tool.mjs";
import { resolveExpectedSourceDigest, workRecordFreshnessSource } from "./work-record-write-route-helpers.mjs";
import { projectOrdinaryWriteFreshness } from "./write-response-boundary.mjs";
import { workRecordEntryContent } from "./work-record-write-tool-schema-vocabulary.mjs";

export function entryReadResultUsesCompactGuard(result){return result?.body===undefined;}
export const WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME="workspace_work_record_entry_upsert";
export const WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME="workspace_work_record_entry_read";
const bytes=value=>Buffer.byteLength(JSON.stringify(value),"utf8");
function withSize(result){return{...result,response_size:{bytes:bytes(result),limit:WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES}};}
function boundedRefusal(result){return withSize({ok:false,valid:false,written:false,record_id:result.record_id??null,
  source_digest:result.source_digest??null,diagnostics:[{code:"work_record_entry_compact_result_too_large",severity:"error",authority_limb:"mechanical",message:`entry result cannot fit ${WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES} UTF-8 bytes without losing required metadata`,path:"entry"}],next_calls:[]});}

export function createWorkRecordEntryReadSchema(z,{repo=undefined,unit=undefined}={}){
  const entryId=z.number().int().positive();
  const digest=z.string().regex(WORK_RECORD_FRESHNESS_PATTERN);
  const exclude=(context,args,fields,message)=>{
    for(const field of fields){
      if(args[field]===undefined)continue;
      context.addIssue({code:z.ZodIssueCode.custom,path:[field],message});
    }
  };
  const selection=z.object({text:z.string().min(1).refine(isUnicodeScalarString).refine(value=>Buffer.byteLength(value,"utf8")<=WORK_RECORD_SELECTION_MAX_UTF8_BYTES)}).strict();
  const readFields=["entry_id","version","view","include_body","reference_only","offset","length","limit",
    "expected_source_digest","selection","continuation"];
  const only=(context,args,allowed,message)=>exclude(context,args,readFields.filter(field=>!allowed.includes(field)),message);
  return z.object({...(repo===undefined?{}:{repo}),...(unit===undefined?{}:{unit}),
    entry_id:entryId.optional(),version:entryId.optional(),
    view:z.literal("history").optional(),include_body:z.literal(true).optional(),reference_only:z.literal(true).optional(),
    offset:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
    length:z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    limit:z.number().int().positive().max(WORK_RECORD_ENTRY_METADATA_PAGE_MAX).optional(),
    expected_source_digest:digest.optional(),selection:selection.optional(),
    continuation:z.string().min(1).optional()}).strict().superRefine((args,context)=>{
      const requireDigest=()=>{
        if(args.offset>0&&args.expected_source_digest===undefined)context.addIssue({code:z.ZodIssueCode.custom,
          path:["expected_source_digest"],message:"a later metadata page requires expected_source_digest"});
      };
      if(args.continuation!==undefined){
        only(context,args,["continuation"],"continuation resumes one returned choice call and accepts no other selector");
        return;
      }
      if(args.entry_id===undefined){
        only(context,args,["limit","offset","expected_source_digest"],
          "without entry_id only limit, offset and expected_source_digest page the unit's entries");
        requireDigest();
        return;
      }
      if(args.view!==undefined){
        only(context,args,["entry_id","view","limit","offset","expected_source_digest"],
          "view \"history\" pages an entry's immutable versions with limit, offset and expected_source_digest");
        requireDigest();
        return;
      }
      if(args.include_body!==undefined){
        only(context,args,["entry_id","include_body","version","offset","length","expected_source_digest"],
          "a body page accepts version, offset, length and expected_source_digest");
        if(args.offset>0&&args.version===undefined)context.addIssue({code:z.ZodIssueCode.custom,path:["version"],
          message:"a later body page requires its immutable version"});
        return;
      }
      if(args.reference_only!==undefined){
        only(context,args,["entry_id","reference_only","version","offset","length"],
          "a reference read accepts version, offset and length");
        return;
      }
      if(args.selection!==undefined){
        only(context,args,["entry_id","selection","version"],"a selection accepts only version");
        return;
      }
      only(context,args,["entry_id","version"],
        "selected metadata accepts only version; request include_body, reference_only, selection or view explicitly");
    });
}

export function workRecordEntryReadArguments({dir,repository,callRepository=repository,unit,selector}){
  return {dir,repository,callRepository,unit,entryId:selector.entry_id,version:selector.version,view:selector.view,
    includeBody:selector.include_body===true,referenceOnly:selector.reference_only===true,
    offset:selector.offset,length:selector.length,limit:selector.limit,
    expectedSourceDigest:selector.expected_source_digest,selection:selector.selection,
    continuation:selector.continuation};
}

export function projectEntryCallsForOrdinaryReader(result,{tool,identity,repo}){
  const rewrite=value=>{
    if(Array.isArray(value))return value.map(rewrite);
    if(value===null||typeof value!=="object")return value;
    if(value.tool===WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME&&value.arguments!==null&&
       typeof value.arguments==="object"&&!Array.isArray(value.arguments)){
      const{repo:_repo,unit:_unit,...selector}=value.arguments;
      return{...value,tool,arguments:{...(repo===undefined?{}:{repo}),...identity,entry:selector}};
    }
    return Object.fromEntries(Object.entries(value).map(([key,entry])=>[key,rewrite(entry)]));
  };
  return rewrite(result);
}

export function boundedEntryReadResult(result){
  return entryReadResultUsesCompactGuard(result)&&bytes(result)>WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES
    ?boundedRefusal(result):result;
}

export function registerWorkRecordEntryTools({registerTool,workspaceRepos,z,jsonContent,errorContent,resolveWorkspaceRepo,
  resolveWorkspaceReadRepo=null,resolveRetainedFindingsSource=null,dispatchSessionIdentity=null}){

  const resolveReadWorkspace=resolveWorkspaceReadRepo??(args=>resolveWorkspaceRepo(workspaceRepos,args.repo));
  const repo=z.string().optional(),unit=z.string(),digest=z.string().regex(WORK_RECORD_FRESHNESS_PATTERN),entryId=z.number().int().positive(),
    title=z.string(),kind=z.string(),content=workRecordEntryContent(z);

  const upsertSchema=z.object({repo,unit,entry_id:entryId.optional(),
    title:title.describe("Required when entry_id is omitted to create a new entry; optional when versioning an existing entry.").optional(),
    kind:kind.optional(),content:content.describe("Required when entry_id is omitted to create a new entry; optional when versioning an existing entry.").optional(),
    expected_source_digest:digest}).strict().superRefine((args,context)=>{
      if(args.entry_id===undefined&&args.title===undefined){
        context.addIssue({code:z.ZodIssueCode.custom,path:["title"],
          message:"title is required when entry_id is omitted, because omitting entry_id creates a new entry"});
      }
      if(args.entry_id===undefined&&args.content===undefined){
        context.addIssue({code:z.ZodIssueCode.custom,path:["content"],
          message:"content is required when entry_id is omitted, because omitting entry_id creates a new entry"});
      }
    });
  registerTool(WORKSPACE_WORK_RECORD_ENTRY_UPSERT_TOOL_NAME,{writeSemantics:MCP_WRITE_SEMANTICS.ACTION_REPLACE_OR_APPEND,
    description:"Create one addressable work-record entry or append an immutable version. Requires current target source_digest; uncertain publication is recovered by canonical reads.",inputSchema:upsertSchema},async args=>{
      try{
        const workspace=resolveWorkspaceRepo(workspaceRepos,args.repo);

        const digest=await resolveExpectedSourceDigest(args.expected_source_digest,
          {load:workRecordFreshnessSource(workspace.dir,args.unit)});
        if(!digest.ok){
          const refused=projectOrdinaryWriteFreshness({ok:false,valid:false,written:false,
            diagnostics:[digest.diagnostic],expected_source_digest:args.expected_source_digest,
            ...(digest.stale?{current_source_digest:digest.current_source_digest,source_digest:digest.current_source_digest,
              next_calls:[{tool:WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME,arguments:{repo:workspace.repo,unit:args.unit},recommended:true}]}:{})});
          return jsonContent(withSize(refused));
        }
        const result=projectOrdinaryWriteFreshness(await upsertWorkRecordEntry({dir:workspace.dir,repository:workspace.repo,
          unit:args.unit,entryId:args.entry_id,title:args.title,kind:args.kind,content:args.content,
          expectedSourceDigest:digest.value,
          resolveExternalReference:typeof resolveRetainedFindingsSource==="function"
            ?({reference,repository})=>resolveRetainedFindingsSource({reference,repository,
                caller_session_id:dispatchSessionIdentity})
            :null}));
        const sized=withSize(result);
        return jsonContent(bytes(sized)>WORK_RECORD_COMPACT_RESULT_MAX_UTF8_BYTES?boundedRefusal(result):sized);
      }catch(error){return errorContent(error);}
    });
  const readSchema=createWorkRecordEntryReadSchema(z,{repo,unit});
  registerTool(WORKSPACE_WORK_RECORD_ENTRY_READ_TOOL_NAME,{writeSemantics:MCP_WRITE_SEMANTICS.NONE,
    description:`Read entry or history metadata pages, immutable bodies (the complete remainder unless length selects a range; large results spill losslessly), requested references, or exact literal selections. Results carry source_digest; returned calls pin version, offsets and source digest.`,inputSchema:readSchema},async args=>{
      try{
        const workspace=resolveReadWorkspace(args);
        const result=await readWorkRecordEntry(workRecordEntryReadArguments({dir:workspace.dir,
          repository:workspace.repo,
          callRepository:Object.hasOwn(workspace,"call_repository")?workspace.call_repository:workspace.repo,
          unit:args.unit,selector:args}));

        return jsonContent(boundedEntryReadResult(result));
      }catch(error){return errorContent(error);}
    });
}
