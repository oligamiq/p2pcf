CREATE TABLE rooms_entries (
  room_id TEXT NOT NULL,
  entry_index INTEGER NOT NULL,
  entry_data TEXT NOT NULL,
  expire_at INTEGER NOT NULL,
  PRIMARY KEY (room_id, entry_index)
);

CREATE TABLE join_counts (
  year_month TEXT NOT NULL,
  origin TEXT NOT NULL,
  count INTEGER NOT NULL,
  PRIMARY KEY (year_month, origin)
);

CREATE TABLE rooms (
  room_id TEXT NOT NULL PRIMARY KEY,
  max_index INTEGER NOT NULL,
  expire_at INTEGER NOT NULL
);

CREATE TABLE room_live (
  room_id TEXT NOT NULL PRIMARY KEY,
  expire_at INTEGER
);
