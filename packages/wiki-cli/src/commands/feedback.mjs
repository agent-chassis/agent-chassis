import { parseArgs, readBoundedJsonStdin } from '../lib/cli.mjs';
import { recordAgentFeedback, feedbackRefusal } from '@agent-chassis/wiki-core/src/operations/agent-feedback.mjs';
import { feedbackInvalid } from '@agent-chassis/wiki-core/src/lib/agent-feedback-schema.mjs';

export async function runFeedback(argv, { packageDocsCarrier = null } = {}) {
  try {
    const { positionals, options } = parseArgs(argv);
    if (positionals.length !== 1 || positionals[0] !== 'add') {
      throw feedbackInvalid('Use wiki feedback add --stdin --new-session|--session <id>');
    }
    const allowed = ['dir', 'json', 'stdin', 'new-session', 'session'];
    const unknown = Object.keys(options).filter(key => !allowed.includes(key));
    if (unknown.length) throw feedbackInvalid(`Unknown feedback options: ${unknown.join(', ')}`);
    for (const key of ['stdin', 'new-session', 'json']) {
      if (key in options && options[key] !== true) throw feedbackInvalid(`--${key} accepts no value`);
    }
    for (const key of ['dir', 'session']) {
      if (key in options && (typeof options[key] !== 'string' || !options[key])) throw feedbackInvalid(`--${key} requires a value`);
    }
    if (options.stdin !== true) throw feedbackInvalid('feedback add requires --stdin');
    const receipt = await recordAgentFeedback({ directory: options.dir ?? process.cwd(), submission: {
      ...(options['new-session'] ? { new_session: true } : {}),
      ...(options.session ? { session_id: options.session } : {}), report: await readBoundedJsonStdin()
    }, transport: 'cli', role: null, corePackage: packageDocsCarrier === null ? null
      : { name: packageDocsCarrier.packageName, version: packageDocsCarrier.packageVersion } });
    const result = { saved: true, ...receipt, next_calls: [] };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } catch (error) {
    const result = feedbackRefusal(error);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = 1;
    return result;
  }
}
