/** Installed explicitly by the entry point; retain the original terminating signal. */
export function initShutdown(
	cleanup: () => Promise<void>,
	log: (error: unknown) => void,
) {
	let stopping = false;
	const finish = async (signal: NodeJS.Signals) => {
		if (stopping) return;
		stopping = true;
		try {
			await cleanup();
		} catch (error) {
			log(error);
		} finally {
			process.removeListener("SIGINT", onInt);
			process.removeListener("SIGTERM", onTerm);
			process.kill(process.pid, signal);
		}
	};
	const onInt = () => {
		void finish("SIGINT");
	};
	const onTerm = () => {
		void finish("SIGTERM");
	};
	process.on("SIGINT", onInt);
	process.on("SIGTERM", onTerm);
}
