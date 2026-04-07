#!/usr/bin/env node
/**
 * Interactive chat CLI — talk to individual agents directly.
 * Useful for ad-hoc questions without running the full orchestrator loop.
 *
 * Usage:
 *   node cli.js
 *   node cli.js --cwd /path/to/project
 */

const readline = require("readline");
const { chatWithAgent, listAgents } = require("./agents");

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

const COLORS = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m",
  cyan: "\x1b[36m", green: "\x1b[32m", yellow: "\x1b[33m",
  blue: "\x1b[34m", magenta: "\x1b[35m", red: "\x1b[31m",
  gray: "\x1b[90m", white: "\x1b[97m",
};

const AGENT_COLORS = {
  owner: "magenta", architect: "cyan",
  "dev-backend": "green", "dev-frontend": "blue", "dev-devops": "yellow",
  qa: "yellow", cerberus: "red",
};

function color(text, ...styles) {
  return styles.map((s) => COLORS[s] || "").join("") + text + COLORS.reset;
}

function printBanner() {
  console.clear();
  console.log(color("\n  ╔══════════════════════════════════════════╗", "cyan", "bold"));
  console.log(color("  ║     AI Minions — Orchestrator Example    ║", "cyan", "bold"));
  console.log(color("  ╚══════════════════════════════════════════╝\n", "cyan", "bold"));
}

function printAgentList(agents) {
  console.log(color("  Select an agent:\n", "white"));
  agents.forEach((a, i) => {
    const c = AGENT_COLORS[a.id] || "white";
    console.log(
      color(`  [${i + 1}] `, "gray") +
      color(a.name, c, "bold") +
      color(` — ${a.title}`, "dim") +
      color(` (${a.mode})`, "gray")
    );
  });
  console.log(color("\n  [0] Exit\n", "gray"));
}

function printMessage(role, name, text, agentId) {
  const c = agentId ? (AGENT_COLORS[agentId] || "white") : "white";
  const label = role === "user" ? color("  You", "white", "bold") : color(`  ${name}`, c, "bold");
  console.log("\n" + label + color(" ›", "dim"));
  text.split("\n").forEach((line) => console.log("  " + line));
}

async function runChat(agentId, agentName, cwd) {
  const c = AGENT_COLORS[agentId] || "white";
  console.log(
    color(`\n  Chat with ${agentName}`, c, "bold") +
    color(`  (dir: ${cwd})`, "dim") +
    color("  (type 'exit' to return to menu)\n", "gray")
  );

  let history = [];
  while (true) {
    const input = await ask(color("  › ", "dim"));
    const text = input.trim();
    if (!text) continue;
    if (text.toLowerCase() === "exit") break;

    process.stdout.write(color(`\n  ${agentName} is working`, c) + color("...\n", "dim"));
    try {
      const { reply, history: h } = await chatWithAgent(agentId, text, history, { cwd });
      history = h;
      printMessage("agent", agentName, reply, agentId);
    } catch (err) {
      console.log(color(`\n  Error: ${err.message}`, "yellow"));
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cwd" && args[i + 1]) cwd = args[++i];
  }

  // Exclude orchestrator (Ollama-only, not useful for interactive chat)
  const chatAgents = listAgents().filter((a) => a.id !== "orchestrator");

  while (true) {
    printBanner();
    console.log(color(`  Directory: ${cwd}\n`, "dim"));
    printAgentList(chatAgents);

    const choice = await ask(color(`  Choose an agent [0-${chatAgents.length}]: `, "white"));
    const index = parseInt(choice, 10);

    if (index === 0) {
      console.log(color("\n  Goodbye!\n", "gray"));
      rl.close();
      break;
    }
    if (index >= 1 && index <= chatAgents.length) {
      await runChat(chatAgents[index - 1].id, chatAgents[index - 1].name, cwd);
    } else {
      console.log(color("\n  Invalid option.\n", "yellow"));
      await new Promise((r) => setTimeout(r, 800));
    }
  }
}

main().catch((e) => { console.error(e); rl.close(); process.exit(1); });
