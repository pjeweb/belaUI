export function validateInteger(
	num: string | number,
	min: number,
	max: number,
) {
	const numTmp = Number.parseInt(String(num), 10);
	if (
		!Number.isFinite(numTmp) ||
		String(numTmp) !== String(num) ||
		numTmp < min ||
		numTmp > max
	)
		return undefined;
	return numTmp;
}

export function validatePortNo(num: string | number) {
	return validateInteger(num, 1, 0xffff);
}
