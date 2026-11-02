/*
    belaUI - web UI for the BELABOX project
    Copyright (C) 2020-2022 BELABOX project

    This program is free software: you can redistribute it and/or modify
    it under the terms of the GNU General Public License as published by
    the Free Software Foundation, either version 3 of the License, or
    (at your option) any later version.

    This program is distributed in the hope that it will be useful,
    but WITHOUT ANY WARRANTY; without even the implied warranty of
    MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
    GNU General Public License for more details.
    You should have received a copy of the GNU General Public License
    along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

export function waitForAudioSource(
	getSource: () => string | undefined,
	signal: AbortSignal,
	unavailable: () => void,
	interval = 1000,
): Promise<string> {
	return new Promise((resolve, reject) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		const abort = () => {
			clearTimeout(timer);
			signal.removeEventListener("abort", abort);
			reject(signal.reason);
		};
		const poll = () => {
			if (signal.aborted) {
				abort();
				return;
			}
			const source = getSource();
			if (source) {
				signal.removeEventListener("abort", abort);
				resolve(source);
				return;
			}
			unavailable();
			timer = setTimeout(poll, interval);
		};
		signal.addEventListener("abort", abort, { once: true });
		poll();
	});
}
