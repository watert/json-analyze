import minimist from "minimist";
import { getByPath } from "../paths.js";
import { splitPath } from "../path-utils.js";
import { readJsonFromTarget } from "../io.js";
import { assertSingleInputTarget } from "../input-resolve.js";
import { pathExists } from "../runtime/fs.js";
import { printHelp } from "./help.js";
import { outputResult, resolveTargetsFromArgv } from "./shared.js";

function inferLabel(path: string): string {
  const segs = splitPath(path);
  const keys = segs.filter((s) => s.type === "key" && s.value);
  if (keys.length >= 2) return keys[keys.length - 2].value!;
  if (keys.length === 1) return keys[0].value!;
  return path;
}

export async function runCompare(rawArgv: string[]) {
  const argv = minimist(rawArgv, {
    string: ["format", "labels", "fields"],
    boolean: ["help", "pretty"],
    alias: { h: "help", f: "format", p: "pretty" },
    default: { format: "md-table", limit: 10 },
  });
  if (argv.help) {
    printHelp("compare");
    return;
  }

  const labelStr = argv.labels as string | undefined;
  const labels = labelStr ? labelStr.split(",").map((s) => s.trim()) : [];

  const allArgs = argv._.map(String);
  let file: string | undefined;
  let paths: string[];
  if (allArgs.length >= 2) {
    const last = allArgs[allArgs.length - 1];
    if (await pathExists(last)) {
      file = last;
      paths = allArgs.slice(0, -1);
    } else {
      paths = allArgs;
    }
  } else {
    throw new Error("need at least 2 paths to compare");
  }

  if (paths.length < 2) throw new Error("need at least 2 paths to compare");

  const format = argv.format as string;
  if (!["md-table", "json"].includes(format)) throw new Error(`unknown format "${format}", expected "md-table"|"json"`);
  const resolveArgv = { ...argv, _: file ? [file] : [] };
  const { targets } = await resolveTargetsFromArgv(resolveArgv);
  assertSingleInputTarget(targets, "compare");
  const data = await readJsonFromTarget(targets[0]);
  const limit = Number(argv.limit) || 10;
  const fieldStr = argv.fields as string | undefined;
  const fields = fieldStr ? fieldStr.split(",").map((s) => s.trim()) : null;

  const columns = paths.map((p, i) => {
    const vals = getByPath(data, p, { limit });
    return {
      label: labels[i] || inferLabel(p),
      path: p,
      values: vals,
    };
  });

  const maxRows = Math.max(...columns.map((c) => c.values.length));

  if (format === "md-table") {
    if (fields) {
      for (const c of columns) {
        console.log(`### ${c.label}`);
        console.log("");
        for (let row = 0; row < maxRows; row++) {
          const v = c.values[row];
          if (!v || typeof v !== "object") {
            console.log(`- row ${row + 1}: \`${JSON.stringify(v)}\``);
            continue;
          }
          console.log(`| field | value |`);
          console.log(`|-------|-------|`);
          for (const f of fields) {
            const fv = (v as Record<string, unknown>)[f];
            console.log(`| ${f} | \`${fv ?? "-"}\` |`);
          }
          console.log("");
        }
      }
    } else {
      const header = "| " + columns.map((c) => c.label).join(" | ") + " |";
      const sep = "|" + columns.map(() => "--------").join("|") + "|";
      console.log(header);
      console.log(sep);

      for (let row = 0; row < maxRows; row++) {
        const cells = columns.map((c) => {
          const v = c.values[row];
          if (v === undefined) return "";
          if (typeof v === "object") return JSON.stringify(v);
          return String(v);
        });
        console.log("| " + cells.join(" | ") + " |");
      }
    }

    console.log("");
    for (const c of columns) {
      console.log(`- \`${c.label}\`: \`${c.path}\``);
    }
  } else {
    outputResult(columns.map((c) => ({ label: c.label, path: c.path, values: c.values })), "json", !!argv.pretty);
  }
}