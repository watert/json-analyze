// json-analyze CLI 入口
import minimist from "minimist";
import { KNOWN_COMMANDS, type SubCommand } from "./constants.js";
import { printHelp } from "./help.js";
import { runOverview } from "./run-overview.js";
import { runAnalyze } from "./run-analyze.js";
import { runFilter } from "./run-filter.js";
import { runSummary } from "./run-summary.js";
import { runGet } from "./run-get.js";
import { runExplore } from "./run-explore.js";
import { runSearch } from "./run-search.js";
import { runCompare } from "./run-compare.js";
import { runDiff } from "./run-diff.js";

export async function runCli(argvList: string[]) {
  const argv = minimist(argvList, {
    boolean: ["help"],
    alias: { h: "help" },
  });
  if (argv.help && !argv._.length) {
    printHelp("help");
    return;
  }

  const first = argv._[0] as string | undefined;
  const isSubCmd = first !== undefined && KNOWN_COMMANDS.has(first);
  const rest = isSubCmd ? argvList.slice(argvList.indexOf(first!) + 1) : argvList;

  if (!isSubCmd) {
    return runOverview(argvList);
  }

  const cmd = first as SubCommand;
  if (cmd === "help") {
    printHelp("help");
    return;
  }

  if (cmd === "analyze") return runAnalyze(rest);
  if (cmd === "filter") return runFilter(rest);
  if (cmd === "summary") return runSummary(rest);
  if (cmd === "get") return runGet(rest);
  if (cmd === "explore") return runExplore(rest);
  if (cmd === "search") return runSearch(rest);
  if (cmd === "compare") return runCompare(rest);
  if (cmd === "diff") return runDiff(rest);
}