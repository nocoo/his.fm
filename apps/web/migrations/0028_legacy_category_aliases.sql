INSERT OR IGNORE INTO category_id_aliases (alias, category_id)
SELECT 'life', 'look-outside'
FROM categories
WHERE id = 'look-outside'
LIMIT 1;
