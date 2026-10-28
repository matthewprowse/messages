// What the database still needs to know about a file now that its name is encrypted: its extension, whether the
// name reads like a receipt or invoice (which keeps a PDF out of Junk), and whether it is a WhatsApp sticker.
// Only these small values reach SQL (attachments.file_ext, keep_hint, is_sticker), never the name. The pattern is
// the one public.attachment_looks_kept used before (20261023013000_attachment_cleanup.sql).

const KEPT = /(receipt|invoice|ticket|statement|booking|itinerary|confirmation|reservation|boarding|voucher|order|tax|bill|payslip|payment|purchase|quotation|quote|rechnung|factura|factuur|recibo)/i;

export interface FileHints {
  ext: string | null;
  keep: boolean;
  sticker: boolean;
}

export function fileHints(filename: string): FileHints {
  const ext = /\.([A-Za-z0-9]{1,8})$/.exec(filename)?.[1]?.toLowerCase() ?? null;
  return { ext, keep: KEPT.test(filename), sticker: /^Sticker\./i.test(filename) };
}
