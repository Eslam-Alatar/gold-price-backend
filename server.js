const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');

const app = express();
const PORT = process.env.PORT || 3000;

app.get('/api/gold-rates', async (req, res) => {
    try {
        const response = await axios.get('https://market.isagha.com/prices', {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
        });

        const $ = cheerio.load(response.data);
        let prices = { karat24: 0, karat21: 0, karat18: 0 };

        $('table tbody tr').each((index, element) => {
            const rowText = $(element).find('td').eq(0).text().trim();
            const priceText = $(element).find('td').eq(1).text().replace(/[^\d.]/g, '').trim();
            const priceValue = parseFloat(priceText);

            if (rowText.includes('24')) prices.karat24 = priceValue;
            if (rowText.includes('21')) prices.karat21 = priceValue;
            if (rowText.includes('18')) prices.karat18 = priceValue;
        });

        res.json({
            success: true,
            rates: prices
        });

    } catch (error) {
        console.error("Scraping Error:", error.message);
        res.status(500).json({ success: false, error: "Failed to fetch market rates" });
    }
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});