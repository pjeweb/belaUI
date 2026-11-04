import { initShutdown } from "../../helpers/shutdown.ts";
initShutdown(
	async () => {
		await new Promise((resolve) => setTimeout(resolve, 5));
		console.log("cleaned");
	},
	() => {},
);
process.kill(process.pid, "SIGTERM");
