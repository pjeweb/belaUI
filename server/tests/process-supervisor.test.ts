import { expect, test } from "bun:test";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { ProcessSupervisor } from "../modules/streaming/process-supervisor.ts";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
class Child extends EventEmitter {
	stderr = new EventEmitter();
	signals: string[] = [];
	constructor(
		public spawnfile: string,
		private order: string[],
	) {
		super();
	}
	kill(signal: NodeJS.Signals) {
		this.signals.push(signal);
		this.order.push(`${this.spawnfile}:${signal}`);
		queueMicrotask(() => {
			this.emit("close");
		});
		return true;
	}
}
function fixture() {
	const order: string[] = [];
	const children: Child[] = [];
	const errors: string[] = [];
	const supervisor = new ProcessSupervisor(
		(command) => {
			const child = new Child(command, order);
			children.push(child);
			return child as unknown as ChildProcess;
		},
		(error) => {
			errors.push(error);
		},
		20,
	);
	return { supervisor, children, order, errors };
}

test("child error/close retries once and Stop cancels restart timers", async () => {
	const f = fixture();
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		() => {},
	);
	f.children[0]?.emit("error", new Error("synthetic spawn error"));
	f.children[0]?.emit("close");
	await sleep(10);
	expect(f.children.length).toBe(2);
	expect(f.errors.length).toBe(1);
	f.children[1]?.emit("close");
	await f.supervisor.stop();
	await sleep(10);
	expect(f.children.length).toBe(2);
});
test("ordered Stop terminates encoder before sender and permits a later session", async () => {
	const f = fixture();
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"srtla_send",
		() => [],
		2,
		() => {},
	);
	f.supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	await f.supervisor.stop();
	expect(f.order).toEqual(["belacoder:SIGTERM", "srtla_send:SIGTERM"]);
	f.supervisor.start();
	f.supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	expect(f.children.length).toBe(3);
	await f.supervisor.stop();
});

test("unresponsive children are force-killed before Stop completes", async () => {
	const order: string[] = [];
	const child = new Child("belacoder", order);
	child.kill = (signal) => {
		child.signals.push(signal);
		if (signal === "SIGKILL")
			queueMicrotask(() => {
				child.emit("close");
			});
		return true;
	};
	const supervisor = new ProcessSupervisor(
		() => child as unknown as ChildProcess,
		() => {},
		5,
	);
	supervisor.start();
	supervisor.spawnLoop(
		"belacoder",
		() => [],
		2,
		() => {},
	);
	await supervisor.stop();
	expect(child.signals).toEqual(["SIGTERM", "SIGKILL"]);
});
