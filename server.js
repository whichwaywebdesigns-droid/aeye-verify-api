require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'aeye-verify-api', version: '1.0.0' });
});

// POST /verify
app.post('/verify', async (req, res) => {
  try {
    const { imageUrl, text } = req.body;

    if (!imageUrl && !text) {
      return res.status(400).json({
        error: 'Missing input. Provide imageUrl or text.'
      });
    }

    // IMAGE: Google Vision API
    if (imageUrl) {
      const visionApiKey = process.env.GOOGLE_VISION_API_KEY;
      if (!visionApiKey) {
        return res.status(500).json({ error: 'Vision API key not configured.' });
      }

      const visionRes = await axios.post(
        `https://vision.googleapis.com/v1/images:annotate?key=${visionApiKey}`,
        {
          requests: [{
            image: { source: { imageUri: imageUrl } },
            features: [
              { type: 'SAFE_SEARCH_DETECTION' },
              { type: 'LABEL_DETECTION', maxResults: 10 },
              { type: 'WEB_DETECTION', maxResults: 5 }
            ]
          }]
        }
      );

      const result = visionRes.data.responses[0];
      const safe = result.safeSearchAnnotation || {};
      const labels = (result.labelAnnotations || []).map(l => l.description);
      const webEntities = (result.webDetection?.webEntities || []).map(e => e.description);

      const unsafe = ['LIKELY', 'VERY_LIKELY'];
      const flags = [];
      if (unsafe.includes(safe.adult)) flags.push('adult_content');
      if (unsafe.includes(safe.violence)) flags.push('violence');
      if (unsafe.includes(safe.racy)) flags.push('racy');
      if (unsafe.includes(safe.medical)) flags.push('medical');

      return res.json({
        type: 'image',
        verdict: flags.length > 0 ? 'flagged' : 'clean',
        confidence: flags.length > 0 ? 0.9 : 0.85,
        flags,
        details: { safeSearch: safe, labels, webEntities }
      });
    }

    // TEXT: OpenAI Moderation API
    if (text) {
      const openaiKey = process.env.OPENAI_API_KEY;
      if (!openaiKey) {
        return res.status(500).json({ error: 'OpenAI API key not configured.' });
      }

      const modRes = await axios.post(
        'https://api.openai.com/v1/moderations',
        { input: text },
        { headers: { Authorization: `Bearer ${openaiKey}` } }
      );

      const modResult = modRes.data.results[0];
      const flags = Object.entries(modResult.categories)
        .filter(([, flagged]) => flagged)
        .map(([cat]) => cat);

      const topScore = Math.max(...Object.values(modResult.category_scores));

      return res.json({
        type: 'text',
        verdict: modResult.flagged ? 'flagged' : 'clean',
        confidence: parseFloat((1 - topScore).toFixed(3)),
        flags,
        details: {
          categories: modResult.categories,
          categoryScores: modResult.category_scores
        }
      });
    }

  } catch (error) {
    console.error('Verify error:', error.message);
    res.status(500).json({ error: 'Verification failed.', message: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`A.Eye Verify API running on port ${PORT}`);
});
