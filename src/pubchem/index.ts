/* eslint-disable no-console*/
import PubChemService from './service';
import CompoundService from '../services/compound.service';
import { log, parseIntMap } from './utils';
import { ParsedCompound, RawCompound } from './types';

import Limiter from './limiter';
const [from, to] = process.argv.slice(2).map(parseIntMap);

/**
 * Splits given array by type number or ParsedCompound
 * @param array
 * @returns {compounds: ParsedCompound[], numbers: number[]}
 */
const splitArrayByType = (array: (number | ParsedCompound)[]) => {
	const numbers: number[] = [],
		compounds: ParsedCompound[] = [];

	array.forEach((item) => {
		if (typeof item === 'number') {
			numbers.push(item);
		} else {
			compounds.push(item);
		}
	});
	return { numbers, compounds };
};

const validateRange = (from: number, to: number) => {
	if (from <= 0 || from > to) {
		throw new Error(
			'Invalid range. Start must be greater than 0 and less than `to`'
		);
	}
};

const maxRequestPerInterval = 5;
const requestInterval = 400;

let successCount = 0;
let ids: number[];
let fails: number[] = [];

const service = new CompoundService();
const limiter = new Limiter(requestInterval);
const pubChemService = new PubChemService({
	changeInterval: limiter.changeInterval.bind(limiter),
	interval: requestInterval
});

const checkForFails = () => {
	if (fails.length) {
		console.log('These ids were failed to fetch', fails);
		console.log('Retrying...');
		ids = [...fails];
		fails = [];
		successCount = 0;

		return true;
	}
	return false;
};

const updateSuccessCount = (val: number) => {
	successCount += val;
	if (successCount + fails.length === ids.length) {
		console.log('All requests are resolved!');
		checkForFails() ? throttle() : console.log('No fails');
	}
};

export default async function init(from: number, to: number) {
	validateRange(from, to);
	ids = new Array(to - from + 1).fill(0).map((_, i) => i + from);
	throttle();
}

const throttle = () => {
	const idsToRequest = [...ids];
	limiter.limit(async () => {
		const requests = idsToRequest
			.splice(0, maxRequestPerInterval)
			.map((id) => pubChemService.getRawCompoundById(id));

		if (idsToRequest.length === 0) {
			limiter.stop();
		}

		makeRequests(requests);
	});
};

const makeRequests = async (requests: Promise<RawCompound | number>[]) => {
	const responses = await Promise.all(requests).then((results) => {
		return results.map((res) => {
			if (typeof res === 'number') {
				//TODO these ids may be pushed to an array and should remake a request to pubchem
				log.error('😫FAILED Compound ID:', res);
				return res;
			} else {
				const compound = pubChemService.parseData(res);
				console.log('Completed compound id: ', compound.id);
				return compound;
			}
		});
	});

	const { compounds, numbers } = splitArrayByType(responses);
	if (numbers.length) {
		log.error('Fails', numbers);
	}
	fails = [...fails, ...numbers];
	updateSuccessCount(compounds.length);
	await service.createMany(compounds);
	// Error log case, (later we can create a table)
};

if (from && to) {
	init(from, to);
}
