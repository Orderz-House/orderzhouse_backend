-- Create freelancer_sub_categories table
CREATE TABLE IF NOT EXISTS freelancer_sub_categories (
  id SERIAL PRIMARY KEY,
  freelancer_id INTEGER NOT NULL,
  sub_category_id INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(freelancer_id, sub_category_id),
  FOREIGN KEY (freelancer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (sub_category_id) REFERENCES sub_categories(id) ON DELETE CASCADE
);