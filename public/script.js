console.log("JS Loaded ✅");
let tg = null;

if (typeof window !== "undefined" &&
    window.Telegram &&
    window.Telegram.WebApp) {

    tg = window.Telegram.WebApp;
    tg.expand();
    tg.ready();
    console.log("Telegram detected ✅");

} else {
    console.log("Telegram not detected 🌍");
}



// ===== SAFE TELEGRAM DETECTION =====




// ===== USER ID SETUP =====





function showPage(pageId) {
    const pages = document.querySelectorAll(".page");
    const buttons = document.querySelectorAll(".bottom-nav button");

    pages.forEach(page => page.classList.remove("active"));
    buttons.forEach(btn => btn.classList.remove("active"));

    document.getElementById(pageId).classList.add("active");

    const activeBtn = Array.from(buttons).find(btn =>
        btn.getAttribute("onclick").includes(pageId)
    );

    if (activeBtn) activeBtn.classList.add("active");

    if (pageId === "invite") {
        loadUserData();
        loadReferralList();
        loadReferralHistory();
    }
}










let energy = 100;
let maxEnergy = 100;
let coins = 0;
let cash = 0;


let tapLevel = 1;
let tapPower = 5;
let upgradeCost = 500;




function tapCoin(event) {

    if (energy <= 0) {

        let container = document.querySelector(".page-container");

        container.classList.add("energy-low");

        setTimeout(() => {
            container.classList.remove("energy-low");
        }, 400);

        return;
    }



    energy--;

    fetch("https://hybrid-earn-backend.onrender.com/tap", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
    initData: tg ? tg.initDataUnsafe : null,
})

    })
        .then(res => res.json())
        .then(data => {

            if (data.success) {
                coins = data.coin_balance;   // backend থেকে নতুন balance
                updateUI();
            }

        })
        .catch(err => console.log("Tap error:", err));







    let btn = event.target;
    let rect = btn.getBoundingClientRect();
    tapEffect(rect.left + rect.width / 2, rect.top, tapPower);
    flyCoinToBalance(rect.left + rect.width / 2, rect.top);

}



function flyCoinToBalance(startX, startY) {

    const balanceEl = document.getElementById("balanceDisplay");
    const rect = balanceEl.getBoundingClientRect();

    const coin = document.createElement("div");
    coin.className = "coin";
    document.body.appendChild(coin);

    coin.style.left = startX + "px";
    coin.style.top = startY + "px";

    let endX = rect.left + rect.width / 2;
    let endY = rect.top + rect.height / 2;

    let progress = 0;

    function animate() {
        progress += 0.05;

        let x = startX + (endX - startX) * progress;
        let y = startY + (endY - startY) * progress;

        coin.style.left = x + "px";
        coin.style.top = y + "px";

        if (progress < 1) {
            requestAnimationFrame(animate);
        } else {
            coin.remove();
        }
    }

    animate();
}






function animateBalance(newAmount) {

    const balanceEl = document.getElementById("coinBalance");
    if (!balanceEl) return;

    let current = parseInt(balanceEl.innerText) || 0;
    let increment = (newAmount - current) / 20;

    let interval = setInterval(() => {
        current += increment;

        if (
            (increment > 0 && current >= newAmount) ||
            (increment < 0 && current <= newAmount)
        ) {
            current = newAmount;
            clearInterval(interval);
        }

        balanceEl.innerText = Math.floor(current) + " Coins";
    }, 20);
}




function updateUI() {
    document.getElementById("energy").innerText = energy;

    let percent = (energy / maxEnergy) * 100;
    document.getElementById("energyFill").style.width = percent + "%";

    animateBalance(coins);
}

let wc = document.getElementById("walletCoin");
let wca = document.getElementById("walletCash");

if (wc) wc.innerText = coins;
if (wca) wca.innerText = cash;










// Auto Energy Refill
setInterval(() => {
    if (energy < maxEnergy) {
        energy += 1;
        updateUI();
    }
}, 1000);

function upgradeTap() {
    if (coins < upgradeCost) {
        alert("Not enough coins!");
        return;
    }

    coins -= upgradeCost;
    tapLevel += 1;
    tapPower += 5;
    upgradeCost = Math.floor(upgradeCost * 2);

    document.getElementById("tapLevel").innerText = tapLevel;
    document.getElementById("tapPower").innerText = tapPower;
    document.getElementById("upgradeCost").innerText = upgradeCost;

    updateUI();
}


function watchAd() {

    // এখানে তোমার Monetag ad show করার code থাকবে
    showMonetagAd().then(() => {

        fetch("https://hybrid-earn-backend.onrender.com/reward-ad", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                initData: tg ? tg.initDataUnsafe : null
            })

        })
            .then(res => res.json())
            .then(data => {

                if (data.success) {
                    loadUserData();
                    alert("Ad reward added!");
                }

            })
            .catch(err => console.log("Ad reward error:", err));

    });

}


// ShortLink Setup


function openShortlink() {

    fetch("https://hybrid-earn-backend.onrender.com/shortlink", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())
        .then(data => {

            if (!data.success) {
                alert(data.message || "Already claimed!");
                return;
            }

            coins = data.balance;
            updateUI();

            alert("🔗 +" + data.reward + " coins");

        })
        .catch(err => console.log("Shortlink error:", err));
}




//Daily bonus Stepup


function dailyBonus() {

    fetch("https://hybrid-earn-backend.onrender.com/daily", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())
        .then(data => {

            if (!data.success) {
                alert(data.message || "Daily already claimed!");
                return;
            }

            coins = data.balance;
            updateUI();

            alert("🎁 You received " + data.reward + " coins!");

        })
        .catch(err => console.log("Daily error:", err));
}


let spinning = false;


function startSpin() {

    if (spinning) return;
    spinning = true;

    let wheel = document.getElementById("wheel");

    let extraSpin = 1440;
    let randomDeg = Math.floor(Math.random() * 360);
    let finalDeg = extraSpin + randomDeg;

    wheel.style.transform = "rotate(" + finalDeg + "deg)";

    fetch("https://hybrid-earn-backend.onrender.com/spin", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())
        .then(data => {

            if (!data.success) {
                alert(data.message || "Spin not allowed");
                spinning = false;
                return;
            }

            setTimeout(() => {

                coins = data.balance;  // backend balance
                updateUI();
                coinBurst();

                alert("🎉 You won " + data.reward + " coins!");

                spinning = false;

            }, 4000);

        })
        .catch(err => {
            console.log("Spin error:", err);
            spinning = false;
        });
}


function coinBurst() {

    let wheel = document.getElementById("wheel");
    let rect = wheel.getBoundingClientRect();

    let centerX = rect.left + rect.width / 2;
    let centerY = rect.top + rect.height / 2;

    for (let i = 0; i < 25; i++) {

        let coin = document.createElement("div");
        coin.className = "coin";

        coin.style.left = centerX + "px";
        coin.style.top = centerY + "px";

        document.body.appendChild(coin);

        let angle = Math.random() * 2 * Math.PI;
        let speed = 4 + Math.random() * 4;

        let vx = Math.cos(angle) * speed;
        let vy = Math.sin(angle) * speed;

        let gravity = 0.15;
        let opacity = 1;

        function animate() {
            let x = parseFloat(coin.style.left);
            let y = parseFloat(coin.style.top);

            vx *= 0.98; // air friction
            vy += gravity;

            coin.style.left = x + vx + "px";
            coin.style.top = y + vy + "px";

            opacity -= 0.02;
            coin.style.opacity = opacity;

            if (opacity > 0) {
                requestAnimationFrame(animate);
            } else {
                coin.remove();
            }
        }

        requestAnimationFrame(animate);
    }
}


function tapEffect(x, y, amount) {

    let container = document.getElementById("tapEffectContainer");

    let text = document.createElement("div");
    text.className = "tap-float";
    text.innerText = "+" + amount;

    text.style.left = x + "px";
    text.style.top = y + "px";

    container.appendChild(text);

    setTimeout(() => {
        text.remove();
    }, 800);
}


let refCount = 0;
let refEarn = 0;








//For real refer

function copyRef() {

    let input = document.getElementById("refLink");
    input.select();
    document.execCommand("copy");

    alert("Referral link copied!");
}



// ===== REFERRAL LINK GENERATOR =====
function generateRefLink() {

    if (!tg || !tg.initDataUnsafe || !tg.initDataUnsafe.user) return;

    let botUsername = "EliteLuxeBot";

    let telegramId = tg.initDataUnsafe.user.id;

    let link = "https://t.me/" + botUsername + "?start=" + telegramId;

    let input = document.getElementById("refLink");

    if (input) {
        input.value = link;
    }

    console.log("Referral Link Generated:", link);
}


// Auto generate referral link when page loads
generateRefLink();




// ===== LOAD USER DATA FROM BACKEND =====
function loadUserData() {

    fetch("https://hybrid-earn-backend.onrender.com/user", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())
        .then(data => {

            if (data.success) {

                coins = data.coin_balance || data.balance;
                cash = data.cash_balance || 0;
                refCount = data.referrals || 0;
                refEarn = data.referral_earnings || 0;

                updateUI();

                document.getElementById("cashBalance").innerText = cash + " ৳";
                document.getElementById("coinBalance").innerText = coins + " Coins";

                let refTotal = document.getElementById("totalRef");
                let refEarnEl = document.getElementById("refEarn");

                if (refTotal) refTotal.innerText = refCount;
                if (refEarnEl) refEarnEl.innerText = refEarn;
            }

        })
        .catch(err => console.log("Backend error:", err));

}

// Auto load data
window.addEventListener("DOMContentLoaded", function () {

    if (tg) {
        loadUserData();
        generateRefLink();
    }

    loadEconomyConfig();
    buildSpinWheel();
});





// ===== LOAD REFERRAL LIST =====
function loadReferralList() {

    fetch("https://hybrid-earn-backend.onrender.com/referrals", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())



        .then(data => {

            let container = document.getElementById("refList");
            if (!container) return;

            container.innerHTML = "";

            if (data.length === 0) {
                container.innerHTML = "<p>No referrals yet</p>";
                return;
            }

            data.forEach(user => {

                let div = document.createElement("div");
                div.className = "ref-user";

                div.innerText =
                    (user.username ? "@" + user.username : user.telegram_id) +
                    " | Balance: " + user.balance;

                container.appendChild(div);
            });

        })
        .catch(err => console.log("Referral list error:", err));
}





// ===== LOAD REFERRAL HISTORY =====
function loadReferralHistory() {

    fetch("https://hybrid-earn-backend.onrender.com/referral-history", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null
        })
    })
        .then(res => res.json())

        .then(data => {

            let container = document.getElementById("refHistory");
            if (!container) return;

            container.innerHTML = "";

            if (data.length === 0) {
                container.innerHTML = "<p>No history yet</p>";
                return;
            }

            data.forEach(item => {

                let div = document.createElement("div");
                div.className = "history-item";

                let typeText = item.type === "join_bonus"
                    ? "New Referral Bonus"
                    : "Ad Bonus";

                div.innerText =
                    "+" + item.amount + " coins | " +
                    typeText + " | " +
                    new Date(item.created_at).toLocaleString();

                container.appendChild(div);
            });

        })
        .catch(err => console.log("History error:", err));
}




const canvas = document.getElementById("particles");
const ctx = canvas.getContext("2d");

canvas.width = window.innerWidth;
canvas.height = window.innerHeight;

let particles = [];

for (let i = 0; i < 40; i++) {
    particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: Math.random() * 2,
        d: Math.random() * 1
    });
}

function drawParticles() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "rgba(0,240,255,0.5)";

    particles.forEach(p => {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
    });

    updateParticles();
}

function updateParticles() {
    particles.forEach(p => {
        p.y += p.d;
        if (p.y > canvas.height) {
            p.y = 0;
            p.x = Math.random() * canvas.width;
        }
    });
}

setInterval(drawParticles, 30);




// ===== SUBMIT WITHDRAW =====
function submitWithdraw() {

    if (!tg) {
        alert("Open inside Telegram");
        return;
    }

    let amount = parseInt(document.getElementById("withdrawAmount").value);
    let method = document.getElementById("withdrawMethod").value;
    let account = document.getElementById("withdrawAccount").value;

    if (!amount || amount < 1000) {
        alert("Minimum withdraw is 1000 coins");
        return;
    }

    if (!account || account.length < 5) {
        alert("Enter valid account number");
        return;
    }

    fetch("https://hybrid-earn-backend.onrender.com/withdraw", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null,
            amount: amount,
            method: method,
            account_number: account
        })
    })
        .then(res => res.json())
        .then(data => {

            if (!data.success) {
                alert(data.message || "Withdraw failed");
                return;
            }

            alert("✅ Withdraw request submitted");

            document.getElementById("withdrawAmount").value = "";
            document.getElementById("withdrawAccount").value = "";

            loadUserData(); // refresh balance

        })
        .catch(err => console.log("Withdraw error:", err));
}




function convertCoin() {

    let amount = parseInt(document.getElementById("convertAmount").value);

    if (!amount || amount < 100000) {
        alert("Minimum convert is 100000 coins");
        return;
    }

    fetch("https://hybrid-earn-backend.onrender.com/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            initData: tg ? tg.initDataUnsafe : null,
            amount: amount
        })
    })
        .then(res => res.json())
        .then(data => {

            if (!data.success) {
                alert(data.message || "Convert failed");
                return;
            }

            coins = data.coin_balance || data.balance;
            cash = data.cash_balance;

            updateUI();
            alert("Conversion successful!");

        })
        .catch(err => console.log("Convert error:", err));
}




function loadEconomyConfig() {

    fetch("https://hybrid-earn-backend.onrender.com/economy-config")
        .then(res => res.json())
        .then(data => {

            if (!data) return;

            if (document.getElementById("adReward"))
                document.getElementById("adReward").innerText = data.ad_reward;

            if (document.getElementById("shortlinkReward"))
                document.getElementById("shortlinkReward").innerText = data.shortlink_reward;

            if (document.getElementById("dailyReward"))
                document.getElementById("dailyReward").innerText = data.daily_bonus;

        })
        .catch(err => console.log("Economy config error:", err));
}





const spinRewards = [
    10, 25, 50, 75, 100,
    150, 200, 300, 500,
    750, 1000, 1200,
    1500, 1800, 2000
];

function buildSpinWheel() {

    const wheel = document.getElementById("wheel");
    if (!wheel) return;

    const total = spinRewards.length;
    const angle = 360 / total;

    let gradient = "";
    let segmentsHTML = "";

    spinRewards.forEach((reward, i) => {

        const start = i * angle;
        const end = start + angle;

        const color = i % 2 === 0 ? "#00f0ff" : "#ff00cc";
        gradient += `${color} ${start}deg ${end}deg,`;

        segmentsHTML += `
            <div class="segment"
                 style="transform: rotate(${start + angle / 2}deg) translateY(-100px)">
                ${reward}
            </div>
        `;
    });

    wheel.style.background = `conic-gradient(${gradient.slice(0, -1)})`;
    wheel.innerHTML = segmentsHTML;
}



















