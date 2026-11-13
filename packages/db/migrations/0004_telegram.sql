-- Telegram as a second channel for the same updates as email.

-- The Telegram chat a host or a guest connected. Kept as text: Telegram ids can be larger than 32 bits.
alter table users add column telegram_chat_id text;
alter table participants add column telegram_chat_id text; -- erased when the meetup ends
create index users_telegram on users (telegram_chat_id) where telegram_chat_id is not null;
create index participants_telegram on participants (telegram_chat_id) where telegram_chat_id is not null;

-- One-time links that connect a Telegram chat. Opening the link in Telegram and pressing Start proves
-- the person controls that chat. Only the hash of the code is kept, and it lasts 30 minutes.
create table telegram_links (
  token_hash text primary key,
  user_id uuid references users (id) on delete cascade,
  participant_id uuid references participants (id) on delete cascade,
  expires_at timestamptz not null,
  check ((user_id is null) <> (participant_id is null))
);
