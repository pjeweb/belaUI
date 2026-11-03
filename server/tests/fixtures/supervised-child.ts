import { appendFileSync } from "node:fs";

const mode = process.argv[2];
const marker = process.argv[3];

if (mode === "record-exit") {
	if (!marker) throw new Error("Missing marker path");
	appendFileSync(marker, "start\n");
	process.exit(0);
}

if (mode === "drain") {
	if (!marker) throw new Error("Missing marker path");
	const role = process.argv[4];
	const delay = Number(process.argv[5]);
	process.on("SIGTERM", () => {
		setTimeout(() => {
			appendFileSync(marker, `${role}\n`);
			process.exit(0);
		}, delay);
	});
} else if (mode === "hang") {
	process.on("SIGTERM", () => {});
} else if (mode !== "wait") {
	throw new Error("Unknown child mode");
}

process.on("SIGHUP", () => console.error("hup"));
console.error("ready");
setInterval(() => {}, 1000);
