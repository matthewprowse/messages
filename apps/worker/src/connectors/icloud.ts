import type { AccountRow } from "../db";
import { ImapConnector } from "./imap";
import { ICLOUD_SERVICE, type ICloudCredentials } from "./mail-service";

// iCloud+ Mail, including custom domains: the IMAP connector (./imap.ts) with iCloud's servers, which every
// iCloud account shares, so its credentials are the sign-in alone. Delete moves mail to Deleted Messages.

export { ICLOUD_IMAP, ICLOUD_SMTP, type ICloudCredentials } from "./mail-service";

export class ICloudConnector extends ImapConnector<ICloudCredentials> {
  constructor(account: AccountRow) {
    super(account, ICLOUD_SERVICE);
  }
}
