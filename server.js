const express = require('express');
const path = require('path');
const app = express();

const port = 8181;
const srcDir = path.join(__dirname, 'src');

app.use((req, res, next) => {
    res.set('Cross-Origin-Opener-Policy', 'same-origin');
    res.set('Cross-Origin-Embedder-Policy', 'require-corp');
    next();
});

// Serve static files
app.use(express.static(srcDir));

app.listen(port, () => {
    console.log(`Static server running at http://localhost:${port}`);
});