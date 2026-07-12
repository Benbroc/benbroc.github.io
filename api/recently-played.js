// Vercel Serverless Function: /api/recently-played
// Reads secrets from environment variables (never exposed to the browser).
// Required env vars in your Vercel project settings:
//   SPOTIFY_CLIENT_ID
//   SPOTIFY_CLIENT_SECRET
//   SPOTIFY_REFRESH_TOKEN

module.exports = async (req, res) => {
    const {  SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET, SPOTIFY_REFRESH_TOKEN } = process.env;

    if (!SPOTIFY_CLIENT_ID || !SPOTIFY_CLIENT_SECRET || !SPOTIFY_REFRESH_TOKEN) {
        return res.status(500).json({ error: 'Spotify env vars not configured' });
    }

    try {
        // 1. Exchange refresh token for a short-lived access token
        const basic = Buffer.from(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`).toString('base64');

        const tokenRes = await fetch('https://accounts.spotify.com/api/token', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${basic}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: SPOTIFY_REFRESH_TOKEN
            })
        });

        if (!tokenRes.ok) {
            const errText = await tokenRes.text();
            console.error('Token refresh failed:', errText);
            return res.status(502).json({ error: 'Token refresh failed', details: errText });
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;

        // 2. Try "currently playing" first
        const nowRes = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (nowRes.status === 200) {
            const nowData = await nowRes.json();
            if (nowData && nowData.item) {
                return res.status(200).json({
                    name: nowData.item.name,
                    artist: nowData.item.artists.map((a) => a.name).join(', '),
                    image: (nowData.item.album.images && nowData.item.album.images[0] && nowData.item.album.images[0].url) || '',
                    url: nowData.item.external_urls.spotify,
                    isPlaying: true
                });
            }
        }

        // 3. Fall back to "recently played" (most recent track)
        const recentRes = await fetch('https://api.spotify.com/v1/me/player/recently-played?limit=1', {
            headers: { 'Authorization': `Bearer ${accessToken}` }
        });

        if (!recentRes.ok) {
            const errText = await recentRes.text();
            console.error('Recently-played fetch failed:', errText);
            return res.status(502).json({ error: 'Recently-played fetch failed', details: errText });
        }

        const recentData = await recentRes.json();
        const track = recentData.items && recentData.items[0] && recentData.items[0].track;

        if (!track) {
            return res.status(404).json({ error: 'No recent tracks' });
        }

        // Cache for a minute so repeat visits don't hammer the Spotify API
        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');

        return res.status(200).json({
            name: track.name,
            artist: track.artists.map((a) => a.name).join(', '),
            image: (track.album.images && track.album.images[0] && track.album.images[0].url) || '',
            url: track.external_urls.spotify,
            isPlaying: false
        });

    } catch (err) {
        console.error('Spotify widget error:', err);
        return res.status(500).json({ error: 'Internal error', details: String(err) });
    }
};