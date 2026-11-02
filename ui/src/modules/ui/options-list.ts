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

export type Option = { name: string; disabled?: boolean };

/** Reconcile in place so probe updates preserve open dropdowns and option identity. */
export function reconcileOptions(
	select: HTMLSelectElement,
	groups: Array<Record<string, Option>>,
	selected?: string | null,
) {
	const previous = select.value;
	const entries = new Map(
		Array.from(select.querySelectorAll("option")).map((option) => [
			option.dataset.optionId,
			option,
		]),
	);
	const retained = new Set<HTMLOptionElement>();
	let position = 0;
	for (const [group, options] of groups.entries()) {
		for (const [value, option] of Object.entries(options)) {
			const id = `${group}:${value}`;
			const entry =
				entries.get(id) ?? select.ownerDocument.createElement("option");
			entry.dataset.optionId = id;
			if (entry.value !== value) entry.value = value;
			if (entry.textContent !== option.name) entry.textContent = option.name;
			if (entry.disabled !== Boolean(option.disabled))
				entry.disabled = Boolean(option.disabled);
			if (select.children[position] !== entry)
				select.insertBefore(entry, select.children[position] ?? null);
			retained.add(entry);
			position++;
		}
	}
	for (const entry of Array.from(select.querySelectorAll("option")))
		if (!retained.has(entry)) entry.remove();
	const desired = selected === undefined ? previous : selected;
	if (
		desired !== null &&
		[...retained].some((entry) => entry.value === desired)
	) {
		if (select.value !== desired) {
			for (const entry of retained)
				if (entry.selected && entry.value !== desired) entry.selected = false;
			const chosen = [...retained].find((entry) => entry.value === desired);
			if (chosen) chosen.selected = true;
		}
	} else if (desired === null) select.selectedIndex = -1;
}

export function updateOptionList(
	select: JQuery,
	options: Array<Record<string, Option>>,
	selected?: string | null,
) {
	const element = select.get(0) as HTMLSelectElement | undefined;
	if (element) reconcileOptions(element, options, selected);
}
