import type { AdmittedProofPackSnapshot } from '../current-admitted-proof-packs.d.mts';
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface CapabilityGap { owner: string; missing: string; source: string; consequence: string }
export type ParameterSource =
  | { policy: 'configurable'; default: null; mapping: string | null }
  | { policy: 'canonical'; mapping: string }
  | { policy: 'derived'; operation: 'definition_constant' | 'alias_same_reference' | 'complete_population_count'; inputs: string[] };
export interface SemanticParameter {
  name: string; purpose: string;
  value_kind: 'typed_referent' | 'complete_population' | 'bounded_observation' |
    'selected_value_comparison' | 'typed_policy_reference' | 'test_assertion_selector';
  roles: string[]; refinement_refs: string[]; applicability_refs: string[]; source: ParameterSource;
}
export interface RoleProducer {
  role: string; kind: 'semantic_parameter' | 'canonical_relationship' | 'definition_constant' |
    'same_reference_alias' | 'complete_population_count' | 'constructor_output' |
    'observation_requirement' | 'capability_gap';
  parameter: string | null; inputs: string[]; rule_refs: string[];
  capability: string | null; gap: CapabilityGap | null;
}
export interface Capability {
  id: string; kind: 'constructor' | 'canonical_resolver' | 'observation_acquisition' | 'evaluation';
  state: 'declared_requirement' | 'implemented' | 'unavailable'; identity: string | null;
  evidence: string; evidence_kind: 'static' | 'executed' | 'requirement'; gap: CapabilityGap | null;
  implementation_version: string | null;
}
export interface PackDependency {
  profile_id: string; profile_version: string; profile_digest: string;
  input_mappings: { input: string; parameter: string }[];
  applicability_refs: string[]; output_uses: string[];
}
export interface PackParameterContract {
  schema_version: 'controlled-contract-pack-parameter-contract.v1';
  profile_id: string; profile_version: string; profile_digest: string; description: string;
  parameters: SemanticParameter[]; role_producers: RoleProducer[];
  construction: { capability: string; semantic_inputs: string[]; declaration_outputs: string[]; required_observations: string[];
    canonical_inputs: { owner: string; source: string; requirement: string }[] };
  dependencies: { state: 'complete'; packs: PackDependency[] } | { state: 'unresolved'; gap: CapabilityGap };
  capabilities: Capability[];
}
export interface ParameterPopulationEntry { pack: AdmittedProofPackSnapshot; contract: PackParameterContract }
export interface ParameterDescription {
  profile_id: string; profile_version: string; profile_digest: string;
  total: number; returned: number; omitted: 0;
  parameters: (SemanticParameter & {
    refinements: { ref: string; value: Json }[];
    constraints: { ref: string; value: Json }[];
  })[];
  construction: PackParameterContract['construction'];
  dependencies: PackParameterContract['dependencies']; capabilities: Capability[];
  constraints: { ref: string; constraint: Json }[];
}
export interface ParameterCoverage {
  profile_id: string; profile_version: string; parameter_contract_digest: string;
  total: number; accounted: number; returned: number; omitted: 0; gaps: number;
  semantic_parameters: number; internal_roles: number;
  rows: (RoleProducer & { refinement: Json })[];
  constraints: { ref: string; constraint: Json }[]; capabilities: Capability[];
}
export class PackParameterError extends Error { code: string; details: { limb: 'mechanical_failure'; field: string; [key: string]: unknown } }
export function validatePackParameterContract(contract: unknown, profile: unknown): PackParameterContract;
export function describePackParameters(contract: PackParameterContract): ParameterDescription;
export function inspectPackParameterCoverage(contract: PackParameterContract, profile: unknown): ParameterCoverage;
export function inspectParameterSource(contract: PackParameterContract, name: string, sources?: { explicit?: Json; canonical?: Json; canonical_references?: { reference_id: string; type_term: string; identity: Json }[] }): Record<string, unknown>;
export function deriveParameterRole(contract: PackParameterContract, role: string, referenceBindings?: Record<string, string[]>): Record<string, unknown>;
export function validateParameterDependencies(contracts: PackParameterContract[]): true;
export function loadPackParameterContract(pack: AdmittedProofPackSnapshot): PackParameterContract;
export function loadCurrentParameterPopulation(): Promise<ParameterPopulationEntry[]>;
export function renderPackParameterDocumentation(contract: PackParameterContract, profile: unknown, admission: unknown): string;
export function renderParameterDocumentationSet(population: ParameterPopulationEntry[]): Map<string, string>;
export interface DocumentationCheck { passed: boolean; missing: string[]; extra: string[]; edited: string[] }
export function checkParameterDocumentation(directory: string, expected: Map<string, string>): Promise<DocumentationCheck>;
export function writeParameterDocumentation(directory: string, expected: Map<string, string>): Promise<DocumentationCheck>;
