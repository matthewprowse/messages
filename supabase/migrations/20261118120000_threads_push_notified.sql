-- Web push: remembers the newest message of a conversation that the push sender has already looked at, so the same
-- message is never pushed twice (and a message that arrived in quiet hours is not pushed later). Set by the worker
-- (apps/worker/src/push) to the thread's last_message_at; null means never looked at. No index: the sender only reads
-- threads from the last half hour of a few users.
alter table public.threads add column push_notified_at timestamptz;
