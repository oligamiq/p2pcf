# Installing the P2PCF Cloudflare Worker

Setting up the worker is a few simple steps.

### Create a Cloudflare account

Go to https://www.cloudflare.com/ and create an account.

### Set up the D1 bucket

1. Install wrangler
```bash
npm install
```
2. Create Database
```bash
$ npx wrangler d1 create p2pcf --config wrangler_d1.toml

 ⛅️ wrangler 3.95.0
-------------------

✅ Successfully created DB 'p2pcf' in region APAC
Created your new D1 database.

[[d1_databases]]
binding = "DB"
database_name = "p2pcf"
database_id = "9f36844b-fbde-4505-b420-a08c8fb20b78"
```

Replace the `database_id` in `wrangler.toml` with the one you just created.

1. Create the D1 Database
```bash
npx wrangler d1 execute p2pcf --local --file d1.sql --config wrangler_d1.toml
```

### Create the Cloudflare Worker
```bash
npx wrangler deploy --config wrangler_d1.toml
```

1. (Optional) You can add two other optional variables in the `Environment Variables` in `Settings` to increase the security of your worker.
 - `ALLOWED_ORIGINS`: A comma-separated list of origins that will be allowed to access the worker. If you're not offering a public worker, this is recommended.
   - Example: `https://mysite.com,https://app.mysite.com` would limit use of the worker to secured sites running on `mysite.com` or `app.mysite.com`.
 - `ORIGIN_QUOTA`: Number of requests per month to allow for any origin not specified in `ALLOWED_ORIGINS`. If you're offering a public worker, this is recommended to rate limit public usage. The default is 10000 if you have not restricted origins via `ALLOWED_ORIGINS` and zero if origins are restricted (so if you restrict origins, other origins will have no access by default.)
   - Example: `100` would limit use of the worker to 100 requests per month from a given origin.

#### Use your worker in your code

The URL to your worker can be found at the top of the console view of your worker:

![image](https://user-images.githubusercontent.com/220020/181832545-e5306fa4-b408-41e0-be07-027dc4eeab41.png)

To use your worker in your client code, specify it as the `workerUrl` in the options passed to the `P2PCF` constructor:

```
import P2PCF from 'p2pcf'

const p2pcf = new P2PCF('MyUsername', 'MyRoom', { workerUrl: "https://p2pcf.minddrop.workers.dev" })
```

That's it! You now have a free (or cheap) WebRTC signalling server that will stay up as long as Cloudflare is working.
