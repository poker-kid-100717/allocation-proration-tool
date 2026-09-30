import { formatMoney, type CurrencyCode } from "../engine";

export const money = (minor: bigint, currency: CurrencyCode, opts?: { signed?: boolean }) => formatMoney(minor, currency, opts);

const dateTime = new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
export const timestamp = (iso: string) => `${dateTime.format(new Date(iso))} UTC`;

export const count = (n: number) => n.toLocaleString("en-US");

export const plural = (n: number, one: string, many = `${one}s`) => `${count(n)} ${n === 1 ? one : many}`;
