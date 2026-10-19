

import { createHash } from "node:crypto";

export const TYPESCRIPT_EXECUTION_CONTRACT = "canonical-projects.v2";

export function groupTypescriptProjects(projects, observations) {
  const groups = [];
  for (const project of projects) {
    const configs = new Set(observations.get(project.project)?.configurations ?? [project.project]);
    const touching = groups.filter((group) => [...configs].some((config) => group.configs.has(config)));
    const group = { configs, projects: [project] };
    for (const prior of touching) {
      for (const config of prior.configs) configs.add(config);
      group.projects.push(...prior.projects);
      groups.splice(groups.indexOf(prior), 1);
    }
    groups.push(group);
  }
  return groups.map(({ configs, projects: members }) => {
    const configurations = [...configs].sort();
    const population = [...new Set(members.flatMap((member) => member.dependency_population ?? []))].sort();
    const limitations = [...new Set(members.flatMap((member) => member.dependency_limitation
      ? [member.dependency_limitation.message] : []))].sort();
    const invalid = [...new Set(members.flatMap(member => observations.get(member.project)?.invalid ?? []))].sort();
    const grouped = configurations.length > 1;
    return Object.freeze({
      key: grouped ? `scip-typescript#group:${createHash("sha256").update(JSON.stringify(configurations)).digest("hex")}`
        : `scip-typescript#${configurations[0]}`,
      indexer: "scip-typescript", project: configurations[0],
      configurations: Object.freeze(configurations),
      membership: Object.freeze({ state: members.every((member) => observations.get(member.project)?.state === "observed")
        ? "resolved" : "unobserved", configurations: Object.freeze(configurations) }),
      dependency_population: population.length ? Object.freeze(population) : null,
      ...(limitations.length || invalid.length ? { dependency_limitation: Object.freeze({
        code: invalid.length ? "scip_typescript_configuration_invalid" : "scip_typescript_config_input_unavailable",
        message: [...limitations, ...invalid].join("; ") }),
      dependency_blocks_provider: true } : {})
    });
  }).sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0);
}
