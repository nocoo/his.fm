UPDATE episodes SET cover_url = 'https://f.no.mt' || cover_url WHERE cover_url LIKE '/images/%';
UPDATE episodes SET cover_url = 'https://f.no.mt/' || substr(cover_url, 8) WHERE cover_url LIKE '/media/%';
UPDATE episodes SET audio_url = 'https://f.no.mt/' || substr(audio_url, 8) WHERE audio_url LIKE '/media/%';
