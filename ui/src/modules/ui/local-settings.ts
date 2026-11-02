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

type LockSetting = "off" | "on" | "autolock";
let lockSetting: LockSetting = "off";
const lockTimers = new Map<Element, ReturnType<typeof setTimeout>>();

function lockButton(slider: JQuery) {
	return slider.closest(".form-group").find(".button-slider-lock-unlock");
}
function updateLock(slider: JQuery, locked: boolean) {
	slider.slider("option", "disabled", locked);
	lockButton(slider)
		.text(locked ? "🔒" : "🔓")
		.attr("aria-label", locked ? "Unlock slider" : "Lock slider")
		.attr("aria-pressed", String(locked));
	if (!locked) resetSliderAutolock(slider);
}
export function resetSliderAutolock(slider: JQuery) {
	const element = slider.get(0);
	if (!element) return;
	clearTimeout(lockTimers.get(element));
	lockTimers.delete(element);
	if (lockSetting === "autolock")
		lockTimers.set(
			element,
			setTimeout(() => {
				lockTimers.delete(element);
				if (lockSetting === "autolock") updateLock(slider, true);
			}, 5000),
		);
}
export function initSliderLock(slider: JQuery) {
	const button = lockButton(slider);
	const hidden = button.parent().hasClass("d-none");
	button.off("click.sliderLock");
	if (lockSetting === "off") {
		resetSliderAutolock(slider);
		slider.slider("option", "disabled", false);
		button.parent().addClass("d-none");
		return;
	}
	button.parent().removeClass("d-none");
	updateLock(slider, hidden || Boolean(slider.slider("option", "disabled")));
	button.on("click.sliderLock", () => {
		updateLock(slider, !slider.slider("option", "disabled"));
	});
}
function applyLayout(layout: string) {
	$("body").toggleClass("netif-first", layout === "netif-first");
}
export function initLocalSettings() {
	const saved = localStorage.getItem("sliderLocks");
	lockSetting = saved === "on" || saved === "autolock" ? saved : "off";
	$("#sliderLockSetting>select")
		.val(lockSetting)
		.on("change", function () {
			const value = String($(this).val());
			lockSetting = value === "on" || value === "autolock" ? value : "off";
			localStorage.setItem("sliderLocks", lockSetting);
			$(".slider.ui-slider").each(function () {
				initSliderLock($(this));
			});
		});
	const layout =
		localStorage.getItem("layout") === "netif-first"
			? "netif-first"
			: "standard";
	$("#layoutSetting>select")
		.val(layout)
		.on("change", function () {
			const value = String($(this).val());
			localStorage.setItem("layout", value);
			applyLayout(value);
		});
	applyLayout(layout);
}
