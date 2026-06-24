{
    // 1. 擷取字詞
    let wordsElements = Array.from(document.querySelectorAll('.duel-result-row .word span'));
    let words = [];

    if (wordsElements.length > 0) {
        words = wordsElements.map(e => e.innerText.trim()).filter(Boolean);
    } else {
        // 備案：如果找不到 .word span，直接抓 row 的文字
        console.warn("找不到 .word span，改為直接抓取 .duel-result-row 的文字");
        words = Array.from(document.querySelectorAll('.duel-result-row')).map(e => {
            return e.innerText.trim().split('\n')[0]; 
        }).filter(Boolean);
    }

    // 2. 擷取棋盤
    let board = Array.from(document.querySelectorAll('.letter-grid .core-letter-cell')).map(el => {
        let letterNode = el.querySelector('.letter');
        let letter = letterNode ? letterNode.innerText.trim() : '';
        
        let bonusNode = el.querySelector('.bonus .circle');
        let bonus = bonusNode 
            ? bonusNode.innerText.trim() 
            : (el.className.match(/2L|3L|2W|3W|DL|TL|DW|TW/i)?.[0] || '');
            
        let active = el.classList.contains('active');
        
        return { letter, bonus, active };
    });

    // 3. 組合資料
    let payload = {
        date: new Date().toISOString().slice(0, 10),
        wordCount: words.length,
        board: board.length ? board : 'not found',
        words: words
    };

    // 4. 印出結果並複製到剪貼簿
    console.log("擷取完成：", payload);
    copy(payload); 
    console.log("✅ JSON 資料已成功複製到剪貼簿！你可以直接 Ctrl+V 貼上了。");
}