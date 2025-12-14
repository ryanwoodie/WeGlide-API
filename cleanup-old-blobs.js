#!/usr/bin/env node

/**
 * Cleanup script to delete old blob versions and keep only the latest.
 * This frees up Vercel Blob storage quota.
 */

const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const BLOB_BASE_URL = process.env.BLOB_BASE_URL || 'https://blob.vercel-storage.com';

if (!BLOB_TOKEN) {
    console.error('Error: BLOB_READ_WRITE_TOKEN environment variable is required');
    process.exit(1);
}

async function listAllBlobs() {
    const listUrl = `${BLOB_BASE_URL.replace(/\/$/, '')}?limit=1000`;
    const response = await fetch(listUrl, {
        headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
    });

    if (!response.ok) {
        throw new Error(`Failed to list blobs: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.blobs || [];
}

async function deleteBlob(url) {
    const response = await fetch(url, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${BLOB_TOKEN}` }
    });

    if (!response.ok) {
        throw new Error(`Failed to delete blob: ${response.status} ${response.statusText}`);
    }

    return response.json();
}

async function main() {
    console.log('Fetching blob list...');
    const blobs = await listAllBlobs();
    console.log(`Found ${blobs.length} total blobs`);

    // Group blobs by pathname
    const blobsByPathname = {};
    for (const blob of blobs) {
        if (!blobsByPathname[blob.pathname]) {
            blobsByPathname[blob.pathname] = [];
        }
        blobsByPathname[blob.pathname].push(blob);
    }

    console.log(`\nGrouped into ${Object.keys(blobsByPathname).length} unique pathnames:\n`);

    let totalToDelete = 0;
    const deleteList = [];

    // For each pathname, keep only the latest
    for (const [pathname, versions] of Object.entries(blobsByPathname)) {
        // Sort by uploadedAt descending (newest first)
        versions.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt));

        const latest = versions[0];
        const oldVersions = versions.slice(1);

        console.log(`${pathname}:`);
        console.log(`  - Total versions: ${versions.length}`);
        console.log(`  - Latest: ${latest.uploadedAt} (${latest.url.split('/').pop()})`);
        console.log(`  - To delete: ${oldVersions.length} old versions`);

        totalToDelete += oldVersions.length;
        deleteList.push(...oldVersions);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log(`Total blobs to delete: ${totalToDelete}`);
    console.log(`Total blobs to keep: ${Object.keys(blobsByPathname).length}`);
    console.log(`${'='.repeat(60)}\n`);

    if (totalToDelete === 0) {
        console.log('No old blobs to delete. Exiting.');
        return;
    }

    // Confirm deletion
    const isDryRun = process.argv.includes('--dry-run');
    if (isDryRun) {
        console.log('DRY RUN MODE - No blobs will be deleted.');
        console.log('Run without --dry-run to actually delete blobs.\n');
        return;
    }

    console.log('Starting deletion...\n');
    let deleted = 0;
    let failed = 0;

    for (const blob of deleteList) {
        try {
            await deleteBlob(blob.url);
            deleted++;
            process.stdout.write(`\rDeleted: ${deleted}/${totalToDelete} (failed: ${failed})`);
        } catch (error) {
            failed++;
            console.error(`\nFailed to delete ${blob.pathname}: ${error.message}`);
        }
    }

    console.log('\n\nCleanup complete!');
    console.log(`Successfully deleted: ${deleted}`);
    console.log(`Failed: ${failed}`);
}

main().catch(error => {
    console.error('Error:', error);
    process.exit(1);
});
