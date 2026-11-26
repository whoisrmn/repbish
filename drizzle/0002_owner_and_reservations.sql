ALTER TABLE orders ADD COLUMN shopper_key TEXT;
--> statement-breakpoint
CREATE INDEX orders_shopper ON orders(shopper_key, status, expires);
--> statement-breakpoint
CREATE TRIGGER limit_reservations BEFORE INSERT ON orders
WHEN NEW.shopper_key IS NOT NULL AND (
  SELECT count(*) FROM orders WHERE shopper_key=NEW.shopper_key AND status='pending' AND expires>NEW.created
) >= 3 BEGIN
  SELECT RAISE(ABORT, 'reservation_limit');
END;
--> statement-breakpoint
CREATE TABLE store_owner (
  lock_id INTEGER PRIMARY KEY CHECK(lock_id = 1),
  user_id TEXT NOT NULL
);
