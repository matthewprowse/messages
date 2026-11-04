// Who a WhatsApp JID is: the names the link has told us (saved on your phone, or set by the person), the phone number
// behind each privacy ID, and whether a person is you. The maps are size-bounded (least recently used goes first)
// and worked out again on demand, so a dropped entry costs a lookup, not correctness.

import { isLidUser, isPnUser, jidNormalizedUser, type WASocket } from "baileys";
import { BoundedMap } from "./bounded-map";
import { e164 } from "./normalize";
import type { Person } from "./person";
import { whatsappName } from "../contacts/name-rank";

export const MAX_NAMES = 20_000;
export const MAX_LIDS = 20_000;

export class People {
  /** Names by JID: saved on your phone (wins) or set by the person. Also by privacy ID. */
  readonly savedNames = new BoundedMap<string, string>(MAX_NAMES);
  readonly pushNames = new BoundedMap<string, string>(MAX_NAMES);
  /** Phone JIDs by privacy ID, as the link reports them; null when it did not know one yet. */
  readonly pnByLid = new BoundedMap<string, string | null>(MAX_LIDS);

  /** `sock` is read when needed, because the connector swaps the socket on every reconnect. */
  constructor(private readonly sock: () => WASocket | null) {}

  nameOf(...jids: (string | null | undefined)[]): string | null {
    for (const jid of jids) if (jid && this.savedNames.has(jid)) return this.savedNames.get(jid)!;
    for (const jid of jids) if (jid && this.pushNames.has(jid)) return this.pushNames.get(jid)!;
    return null;
  }

  /** Works out who a JID is: phone number and privacy ID where WhatsApp has told us both. */
  async person(jid: string, alt?: string | null, pushName?: string | null): Promise<Person> {
    const ids = [jid, alt].filter((j): j is string => !!j).map((j) => jidNormalizedUser(j));
    let pn = ids.find((j) => isPnUser(j)) ?? null;
    const lid = ids.find((j) => isLidUser(j)) ?? null;
    if (lid && pn) this.pnByLid.set(lid, pn);
    else if (lid) {
      if (!this.pnByLid.has(lid)) {
        const found = await this.sock()?.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
        this.pnByLid.set(lid, found ? jidNormalizedUser(found) : null);
      }
      pn = this.pnByLid.get(lid) ?? null;
    }
    const phone = e164(pn);
    if (pushName) for (const j of [pn, lid]) if (j && !this.pushNames.has(j)) this.pushNames.set(j, pushName);
    const saved = [pn, lid].find((j) => j && this.savedNames.has(j));
    const pushed = [pn, lid].find((j) => j && this.pushNames.has(j));
    // The kind of name goes with it: the database stores the name sealed and decides which one wins by its rank.
    const best = whatsappName(saved ? this.savedNames.get(saved) : null, (pushed ? this.pushNames.get(pushed) : null) ?? pushName, phone ?? lid ?? jid);
    return {
      phone,
      lid,
      jid: pn ?? lid ?? jidNormalizedUser(jid),
      display_name: best.name,
      name_rank: best.rank,
      push_name: pushName ?? (pn && this.pushNames.get(pn)) ?? (lid && this.pushNames.get(lid)) ?? null,
    };
  }

  isMe(person: Person): boolean {
    const me = this.sock()?.user;
    if (!me) return false;
    const mine = [me.id, me.lid].filter(Boolean).map((j) => jidNormalizedUser(j!));
    return mine.includes(person.jid) || (!!person.lid && mine.includes(person.lid));
  }
}
