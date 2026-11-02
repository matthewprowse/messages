// Which channels a reaction can be sent on. The worker's LinkedIn connector can send one (linkedin/react-action.ts), but neither
// LinkedIn helper implements a react command yet, so a queued LinkedIn reaction would only fail later. Until one does, the app
// queues reactions for WhatsApp only: the react button, the clickable reaction chips and the store action all ask here.
// Remove "linkedin" from the gap by adding it to REACTION_CHANNELS in the same change that adds the helper command (docs/PLAN.md).

export const REACTION_CHANNELS: readonly string[] = ["whatsapp"];

/** Whether a reaction on a message in this channel can be sent. */
export const canReactOn = (channel: string | null | undefined): boolean => !!channel && REACTION_CHANNELS.includes(channel);
