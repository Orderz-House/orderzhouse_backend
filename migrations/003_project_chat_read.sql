-- Track last time user read project chat (for unread badge)
CREATE TABLE IF NOT EXISTS project_chat_read (
  user_id INT NOT NULL,
  project_id INT NOT NULL,
  last_read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, project_id)
);
