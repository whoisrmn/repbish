CREATE TABLE products (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, brand TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', category TEXT NOT NULL,
  image TEXT NOT NULL DEFAULT '', front_image TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))
);
--> statement-breakpoint
CREATE TABLE variants (
  id TEXT PRIMARY KEY, product_id TEXT NOT NULL REFERENCES products(id),
  size TEXT NOT NULL, color TEXT NOT NULL, price INTEGER NOT NULL CHECK(price BETWEEN 1 AND 1000000000),
  stock INTEGER NOT NULL CHECK(stock >= 0), active INTEGER NOT NULL CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE INDEX variants_product ON variants(product_id);
--> statement-breakpoint
CREATE TABLE orders (
  id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('pending','paid','shipped','canceled')),
  amount INTEGER NOT NULL, buyer TEXT NOT NULL, phone TEXT NOT NULL, province TEXT NOT NULL,
  address TEXT NOT NULL, wire_id TEXT UNIQUE, checkout_url TEXT, tracking TEXT
);
--> statement-breakpoint
CREATE INDEX orders_pending ON orders(status, expires);
--> statement-breakpoint
CREATE TABLE order_items (
  order_id TEXT NOT NULL REFERENCES orders(id), variant_id TEXT NOT NULL REFERENCES variants(id),
  title TEXT NOT NULL, brand TEXT NOT NULL, size TEXT NOT NULL, color TEXT NOT NULL,
  price INTEGER NOT NULL, quantity INTEGER NOT NULL CHECK(quantity > 0),
  PRIMARY KEY(order_id, variant_id)
);
--> statement-breakpoint
CREATE TRIGGER reserve_stock BEFORE INSERT ON order_items BEGIN
  UPDATE variants SET stock = stock - NEW.quantity, version = version + 1
    WHERE id = NEW.variant_id AND active = 1 AND stock >= NEW.quantity AND price = NEW.price
      AND size = NEW.size AND color = NEW.color
      AND EXISTS (SELECT 1 FROM products p WHERE p.id = variants.product_id AND p.active = 1);
  SELECT CASE WHEN changes() = 0 THEN RAISE(ABORT, 'stock_changed') END;
END;
--> statement-breakpoint
CREATE TRIGGER release_stock AFTER UPDATE OF status ON orders
WHEN OLD.status = 'pending' AND NEW.status = 'canceled' BEGIN
  UPDATE variants SET stock = stock + (
    SELECT quantity FROM order_items WHERE order_id = NEW.id AND variant_id = variants.id
  ), version = version + 1
  WHERE id IN (SELECT variant_id FROM order_items WHERE order_id = NEW.id);
END;
--> statement-breakpoint
CREATE TABLE admin_write_guard (ok INTEGER NOT NULL CHECK(ok = 1));
--> statement-breakpoint
CREATE TRIGGER admin_guard_clear AFTER INSERT ON admin_write_guard BEGIN
  DELETE FROM admin_write_guard;
END;
--> statement-breakpoint
CREATE TABLE looks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, image TEXT NOT NULL,
  pins TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))
);
