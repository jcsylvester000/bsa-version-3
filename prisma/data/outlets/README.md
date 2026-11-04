# Brand-supplied outlet lists (Brief alignment T-5)

The only way an outlet LOCATION becomes **Verified** in BSA: the brand's own branch list.

```powershell
npm run db:load-outlets -- --brand="Macao Imperial Tea" --file=prisma/data/outlets/macao.csv
# include monthly sales ONLY when the brand agreed to share them:
npm run db:load-outlets -- --brand="Macao Imperial Tea" --file=prisma/data/outlets/macao.csv --sales-consent
```

| Column | Required | Notes |
|---|---|---|
| `outlet_name` (or `name`, `branch_name`) | yes | |
| `lat`, `lon` (or `latitude`, `longitude`) | yes | must be inside the Philippines |
| `format` | no | kiosk / inline / mall / freestanding — sets the trade area |
| `status` | no | open (default), closed, renovating; planned / coming soon rows are skipped |
| `monthly_sales_php` | no | loaded only with `--sales-consent`; labelled Assumed (self-reported) |

Example row: `One Ayala,14.5503,121.0266,mall,open,408240`

Labels: `source = brand_list`, `location_truth = verified`, `sales_truth = assumed` (when loaded).
Re-running replaces that brand's previous list only; outlets typed into intakes are untouched.
Then re-run the affected analyses. Do not commit brand files that hold sales figures.
