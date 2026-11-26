# Repbish

Independent Mongolian storefront for sourced apparel. The customer-facing site uses plain HTML, CSS, and JavaScript. The server uses a Cloudflare Worker, D1 for catalog and orders, and R2 for images.

## Local development

Run with Node.js 24 or newer.

```sh
npm run build
npm test
npm run dev
```

The default URL is `http://127.0.0.1:4317/`. The admin is at `/admin`. The preview binds to loopback, uses a separate SQLite database and local image files under `.local/`, and keeps checkout disabled. An empty catalog displays clearly labeled, non-purchasable examples. Actual products come from the admin.

## Catalog and looks

- For each product, enter the source brand, product name, description, and category. Add one variant for each size and color, with an integer MNT price and stock count. Published products require a main image. For the rail, upload a transparent image with the whole hanger in view. A second front-facing photo is optional and appears on hover or keyboard focus.
- To publish a look, upload its outfit image, select one product at a time, and click the image to place the pin. Pin placement is relative to the original image. A published look displays links to its published products.
- The Orders tab shows customer delivery details, payment status, and the items purchased. Mark a paid order shipped and enter a tracking reference if available.

## Hosting and payments

The build produces the Worker at `dist/server/index.js`. The hosting manifest declares the `DB` and `BUCKET` bindings. Both migrations in `drizzle/` must be applied in order.

The hosted owner claims the admin by opening `/admin` while the Site is confirmed owner-private and `OWNER_PRIVATE_SETUP=true`. The stable Site user ID is stored in D1. Disable `OWNER_PRIVATE_SETUP` before switching to public access. For deployments with a trusted identity gateway, `ADMIN_EMAIL` can instead allow exactly one gateway-verified account.

Configure the following in the hosting service’s private runtime environment:

| Key | Value |
| --- | --- |
| `WIRE_API_KEY` | The Wire project’s secret API key |
| `WIRE_WEBHOOK_SECRET` | The signing secret for this Site’s verified Wire webhook |
| `CHECKOUT_ENABLED` | Set to `true` when the merchant is ready to accept payments |

Register `https://YOUR-STORE/webhooks/wire` in the Wire project, subscribe to `payment_intent.succeeded` and `payment_intent.canceled`, and verify the endpoint in Wire. The success or cancel redirect only opens the order-status page. The backend confirms Wire’s payment status and amount independently.

Checkout accepts a Mongolian phone number and a local province or Ulaanbaatar address. Delivery is free nationwide. The tests use stubbed Wire responses and signed fixtures. Live payment and production DNS must be verified with the actual merchant account and domain before launch.
