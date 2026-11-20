#!/usr/bin/env python3
"""Builds the public, indexable pages (home + guides), sitemap.xml and robots.txt.
Run from the repo root:  python3 scripts/build-pages.py
Every page gets: unique title and description, canonical URL, Open Graph / Twitter card, JSON-LD."""
import json, html, datetime, pathlib

SITE = 'https://optionscreener.org'
NAME = 'Options Screener'
TODAY = datetime.date.today().isoformat()
OUT = pathlib.Path(__file__).resolve().parent.parent / 'public'

LOGO = '<svg viewBox="0 0 26 26" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 18.5c3.5 0 4.5-11 10-11s6.5 11 10 11"/><path d="M3 22.5h20" stroke-opacity=".35"/></svg>'
GUIDES = [
    ('/options-flow', 'Options flow', 'Read the tape: sweeps, blocks and big premium'),
    ('/unusual-options-activity', 'Unusual options activity', 'When volume runs ahead of open interest'),
    ('/options-screener', 'Options screener', 'Filter every contract by volume, OI and IV'),
    ('/option-chain', 'Option chain', 'Bid, ask, greeks and IV for every strike'),
]

GLOGO = '<svg class="glogo" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>'

def nav(path):
    return ''.join(f'<a href="{p}"' + (' aria-current="page"' if p == path else '') + f'>{t}</a>' for p, t, _ in GUIDES)

def head(path, title, desc, ld, kind='website'):
    url = SITE + path
    t, d = html.escape(title), html.escape(desc)
    return f'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{t}</title>
<meta name="description" content="{d}">
<link rel="canonical" href="{url}">
<meta name="robots" content="index,follow,max-image-preview:large">
<meta property="og:type" content="{kind}">
<meta property="og:site_name" content="{NAME}">
<meta property="og:title" content="{t}">
<meta property="og:description" content="{d}">
<meta property="og:url" content="{url}">
<meta property="og:image" content="{SITE}/og.png">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:image:alt" content="Options Screener: options flow, option chains and a contract screener">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{t}">
<meta name="twitter:description" content="{d}">
<meta name="twitter:image" content="{SITE}/og.png">
<meta name="theme-color" content="#121417">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="/css/site.css">
<script type="application/ld+json">{json.dumps(ld, separators=(',', ':'))}</script>
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="/">{LOGO}{NAME}</a>
  <nav class="nav" aria-label="Guides">{nav(path)}<a href="/#pricing">Pricing</a></nav>
  <a class="btn" href="/login">Sign in</a><a class="btn pri" href="/login">{GLOGO}Start free</a>
</div></header>
'''

GLIST = ''.join(f'<li><a href="{p}">{t}</a></li>' for p, t, _ in GUIDES)
FOOT = f'''<footer class="foot"><div class="wrap cols">
  <div><a class="brand" href="/">{LOGO}{NAME}</a>
    <p class="disc">Market data and tools for information only. Nothing on this site is investment advice. Options involve substantial risk and are not suitable for every investor.</p></div>
  <div><h4>Guides</h4><ul>{GLIST}</ul></div>
  <div><h4>Company</h4><ul><li><a href="/#pricing">Pricing</a></li><li><a href="/terms">Terms of Service</a></li><li><a href="/privacy">Privacy Policy</a></li><li><a href="/refund">Refund Policy</a></li><li><a href="/privacy#contact">Contact</a></li></ul></div>
</div></footer>
</body>
</html>
'''

ORG = {'@type': 'Organization', '@id': SITE + '/#org', 'name': NAME, 'url': SITE + '/', 'logo': SITE + '/apple-touch-icon.png'}
WEBSITE = {'@type': 'WebSite', '@id': SITE + '/#website', 'name': NAME, 'alternateName': ['OptionScreener', 'optionscreener.org'], 'url': SITE + '/', 'publisher': {'@id': SITE + '/#org'}, 'inLanguage': 'en'}
APP = {'@type': 'SoftwareApplication', '@id': SITE + '/#app', 'name': NAME, 'url': SITE + '/', 'applicationCategory': 'FinanceApplication', 'operatingSystem': 'Web browser',
       'description': 'Web app for US stock options: live options flow, option chains with greeks and IV, and a contract screener.',
       'offers': [{'@type': 'Offer', 'name': 'Free', 'price': '0', 'priceCurrency': 'USD'},
                  {'@type': 'Offer', 'name': 'Pro', 'price': '9.99', 'priceCurrency': 'USD', 'priceSpecification': {'@type': 'UnitPriceSpecification', 'price': '9.99', 'priceCurrency': 'USD', 'billingDuration': 'P1M', 'unitText': 'month'}}],
       'publisher': {'@id': SITE + '/#org'}}

def faq_ld(items):
    return {'@type': 'FAQPage', 'mainEntity': [{'@type': 'Question', 'name': q, 'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in items]}
def faq_html(items):
    return ''.join(f'<details><summary>{html.escape(q)}</summary><p>{html.escape(a)}</p></details>' for q, a in items)

FAQ = [
    ('What is Options Screener?', 'Options Screener is a web app for US stock and ETF options. It shows the live options flow (large trades, sweeps and blocks), full option chains with greeks, implied volatility and open interest, and a screener that filters every contract by volume, open interest, IV, delta and spread.'),
    ('Is Options Screener free?', 'Yes. The free plan lets you open up to 3 symbols a day with full option chains, stock quotes and your watchlist. Pro costs $9.99 a month and adds unlimited symbols, the live options flow, the contract screener, charts and stock insights. You can cancel at any time and there is a 14-day money-back guarantee.'),
    ('How current is the data?', 'Stock prices update during market hours. On the current data feed, option quotes are indicative and option trades can arrive about 15 minutes late. The app shows the time of the newest price at the top of the screen and labels delayed data.'),
    ('What is options flow?', 'Options flow is the stream of option trades as they print. Watching it shows where large amounts of money are going: which tickers, calls or puts, which strikes and expiries, and whether trades were bought at the ask or sold at the bid.'),
    ('What counts as unusual options activity?', 'A contract usually counts as unusual when its volume today is much larger than its open interest or its normal daily volume, especially when the trades are large, aggressive (at or above the ask) and in short-dated or out-of-the-money contracts.'),
    ('Which markets are covered?', 'Listed US stocks and ETFs and their options, including SPY, QQQ, IWM and single stocks such as NVDA, TSLA, AAPL and AMD.'),
    ('How do I cancel Pro?', 'Open the account menu in the app and choose Manage subscription and card. Pro stays active until the end of the period you paid for and is not renewed.'),
    ('Is this investment advice?', 'No. Options Screener provides market data and tools for information only. It is not a broker or investment adviser and does not recommend buying or selling any security.'),
]

def home():
    ld = {'@context': 'https://schema.org', '@graph': [ORG, WEBSITE, APP, faq_ld(FAQ)]}
    rows = [('11:41:23', 'NVDA', '200C 12/19', '$2.4M', 'Sweep', 'g', 'y'), ('11:40:58', 'SPY', '640P 11/28', '$1.1M', 'Block', 'r', 'b'),
            ('11:40:31', 'TSLA', '450C 12/5', '$860K', 'Split', 'g', 'p'), ('11:39:47', 'QQQ', '610C 12/19', '$5.3M', 'Sweep', 'g', 'y'),
            ('11:39:12', 'AMD', '180P 1/16', '$420K', 'Block', 'r', 'b'), ('11:38:40', 'AAPL', '260C 12/12', '$1.8M', 'Sweep', 'g', 'y')]
    tape = ''.join(f'<tr><td class="m">{t}</td><td class="{c}">{s}</td><td>{k}</td><td class="n {c}">{p}</td><td class="{tc}">{ty}</td></tr>' for t, s, k, p, ty, c, tc in rows)
    body = f'''<main>
<div class="wrap hero">
  <div>
    <h1>Options screener and live options flow</h1>
    <p class="lede">See US options activity as it prints. View large trades, sweeps and blocks as they print, open any option chain with greeks and IV, and screen every contract by volume, open interest and implied volatility.</p>
    <div class="cta"><a class="btn pri big" href="/login">{GLOGO}Start free with Google</a><a class="btn big" href="#pricing">See pricing</a>
      <span class="fine">Secure sign-in with Google: we never see or store your password. Free plan: 3 symbols a day, no card needed. Pro: $9.99 a month.</span></div>
  </div>
  <div class="tape" role="img" aria-label="Example of the options flow table">
    <div class="cap"><b>Options flow</b><span>Example</span></div>
    <table><thead><tr><th>Time (ET)</th><th>Ticker</th><th>Contract</th><th class="n">Premium</th><th>Type</th></tr></thead><tbody>{tape}</tbody></table>
  </div>
</div>

<section class="band"><div class="wrap">
  <h2>Everything you need to read the options market</h2>
  <p class="intro">Built for traders who want the options tape, the chain and a screener in one place, without a terminal subscription.</p>
  <div class="feats">
    <div class="feat"><h3>Live options flow</h3><p>Every large print across your watchlist and the most active stocks, tagged as sweep, block or split, with premium, side (ask or bid), size against open interest and repeat orders. Big-trade highlights mark $1M+ premium.</p><a href="/options-flow">How to read options flow</a></div>
    <div class="feat"><h3>Unusual options activity</h3><p>Spot contracts trading far above their open interest, aggressive buying at the ask and repeated orders in the same strike, the signs traders look for before a move.</p><a href="/unusual-options-activity">What makes activity unusual</a></div>
    <div class="feat"><h3>Option chains with greeks</h3><p>Calls and puts side by side for every expiry: bid, ask, last, volume, open interest, implied volatility and delta, updating while the market is open. Star any contract to watch it.</p><a href="/option-chain">How to read an option chain</a></div>
    <div class="feat"><h3>Contract screener</h3><p>Filter thousands of contracts at once by days to expiry, delta, volume, open interest, IV and bid-ask spread. Save your filters and load them on any device.</p><a href="/options-screener">How to screen options</a></div>
    <div class="feat"><h3>Charts</h3><p>IV smile, open interest and volume by strike, and call versus put premium minute by minute.</p></div>
    <div class="feat"><h3>Every listed US stock</h3><p>Browse all listed US stocks and ETFs with price, change and volume, and open the chain of any symbol with options in one click.</p></div>
  </div>
</div></section>

<section class="band" id="pricing"><div class="wrap">
  <h2>Simple pricing</h2>
  <p class="intro">Start free. Upgrade when you want the full flow. One plan, billed monthly, cancel anytime.</p>
  <div class="plans">
    <div class="plan"><h3>Free</h3><div class="price">$0</div><div class="per">forever, no card needed</div>
      <ul><li>3 symbols a day</li><li>Full option chains with greeks and IV</li><li>Stock quotes for every listed US stock</li><li>Watchlist and saved filters</li></ul>
      <a class="btn" href="/login">{GLOGO}Start free with Google</a></div>
    <div class="plan pro"><h3>Pro</h3><div class="price">$9.99</div><div class="per">per month, cancel anytime</div>
      <ul><li>Unlimited symbols, every day</li><li>Live options flow with big-trade highlights</li><li>Contract screener across every expiry and strike</li><li>IV smile, open interest and volume charts</li><li>Stock and contract insights with news</li></ul>
      <a class="btn pri" href="/login">Get Pro</a></div>
  </div>
  <p class="note" style="margin-top:18px">Secure checkout by Paddle, our reseller. Card, PayPal, Google Pay and Apple Pay. 14-day money-back guarantee.</p>
</div></section>

<section class="band"><div class="wrap">
  <h2>Questions</h2>
  <div class="faq">{faq_html(FAQ)}</div>
</div></section>
</main>
'''
    return head('/', 'Options Screener: Live Options Flow & Unusual Options Activity',
                'Free options screener for US stocks: live options flow, sweeps and blocks, unusual options activity, option chains with greeks and IV. Pro $9.99/month.', ld) + body + FOOT

def guide(path, title, h1, desc, lede, sections, faq=()):
    url = SITE + path
    graph = [{'@type': 'Article', 'headline': h1, 'description': desc, 'url': url, 'mainEntityOfPage': url, 'inLanguage': 'en',
              'datePublished': '2026-11-19', 'dateModified': TODAY, 'author': {'@id': SITE + '/#org'}, 'publisher': {'@id': SITE + '/#org'}, 'image': SITE + '/og.png'},
             {'@type': 'BreadcrumbList', 'itemListElement': [{'@type': 'ListItem', 'position': 1, 'name': NAME, 'item': SITE + '/'}, {'@type': 'ListItem', 'position': 2, 'name': h1, 'item': url}]},
             ORG] + ([faq_ld(faq)] if faq else [])
    rel = ''.join(f'<a href="{p}"><b>{t}</b><span>{s}</span></a>' for p, t, s in GUIDES if p != path)
    fq = f'<h2>Questions</h2><div class="faq">{faq_html(faq)}</div>' if faq else ''
    body = f'''<main class="wrap"><article class="article">
<div class="crumbs"><a href="/">{NAME}</a> / {html.escape(h1)}</div>
<h1>{html.escape(h1)}</h1>
<p class="lede">{lede}</p>
{sections}
{fq}
<div class="callout"><p>Try it on live data: open the options flow, any option chain and the screener in Options Screener. Free plan, no card needed; Pro is $9.99 a month.</p><a class="btn pri" href="/login">{GLOGO}Start free with Google</a></div>
<p class="note">For information only. Not investment advice. Options involve substantial risk.</p>
<h2>More guides</h2><div class="related">{rel}</div>
</article></main>
'''
    return head(path, title, desc, {'@context': 'https://schema.org', '@graph': graph}, 'article') + body + FOOT

PAGES = {'home': home()}

PAGES['options-flow'] = guide('/options-flow',
 'Options Flow: How to Read Sweeps, Blocks and Big Trades',
 'Options flow: how to read sweeps, blocks and big trades',
 'What options flow is and how to read it: sweeps vs blocks, buying at the ask vs selling at the bid, premium, size vs open interest, and live options flow for US stocks.',
 'Options flow is the stream of option trades as they print on the exchanges. Reading it well tells you where large traders are putting money: which ticker, calls or puts, which strike and expiry, and how urgently they wanted the trade filled.',
 '''<h2>What is options flow?</h2>
<p>Every option trade in the US prints to the consolidated tape (OPRA) with a price, a size, an exchange and a condition code. Options flow tools collect those prints, add context such as the bid and ask at the moment of the trade, the open interest of the contract and the stock price, and show the biggest and most aggressive ones first.</p>
<p>Most of the tape is noise: market makers hedging, small retail orders and spreads. The trades worth reading are the large, aggressive, single-direction orders, because someone paid real premium and accepted a worse price to get filled now.</p>
<h2>The columns that matter</h2>
<div class="tw"><table><thead><tr><th>Column</th><th>What it tells you</th></tr></thead><tbody>
<tr><td>Premium</td><td>Price × size × 100. The money at risk. $1M+ in a single print is significant for most stocks.</td></tr>
<tr><td>Side</td><td>Where the trade printed against the quote. <b>At or above the ask</b> means the buyer was aggressive; <b>at or below the bid</b> means the seller was.</td></tr>
<tr><td>Type</td><td><b>Sweep</b>: one order split across several exchanges to fill fast. <b>Block</b>: one large negotiated print. <b>Split</b>: one order filled in pieces on the same exchange.</td></tr>
<tr><td>Size vs OI</td><td>When the size is larger than open interest, the trade is very likely opening a new position rather than closing one.</td></tr>
<tr><td>Expiry and strike</td><td>Short-dated, out-of-the-money contracts are leveraged bets on a move soon; far-dated, in-the-money ones are often stock replacement or hedges.</td></tr>
</tbody></table></div>
<h2>Sweeps vs blocks</h2>
<p>A <b>sweep</b> takes liquidity from several exchanges at once, paying up at each one. It signals urgency: the trader cared more about getting filled now than about price. Call sweeps at the ask are the pattern flow watchers discuss most.</p>
<p>A <b>block</b> is a single large trade, often negotiated off-screen and printed in one piece. Blocks can be directional, but they are also used for hedges and for closing or rolling positions, so the side (bid or ask) and the open interest matter more.</p>
<h2>Reading trade direction</h2>
<p>Calls bought at the ask and puts sold at the bid lean to the upside; puts bought at the ask and calls sold at the bid lean to the downside. Trades in the middle of the spread are ambiguous. A flow balance gauge simply adds up the premium on each side.</p>
<p>Keep in mind that a single print never tells you the trader's full position. A large put purchase may hedge a stock position; a call sale may be part of a covered call. Look for repetition: the same contract bought again and again across the day is stronger than one big trade.</p>
<h2>How to use options flow in Options Screener</h2>
<ul><li>The flow table lists the latest prints for your watchlist and the 20 most active stocks, newest first, with premium, side, type, size, volume and open interest.</li>
<li>Filters narrow it down by ticker, minimum premium, calls or puts, side, type, days to expiry and moneyness. Save filter sets and switch between them.</li>
<li>The big-trades feed highlights $250K, $500K, $1M or $5M+ prints.</li>
<li>Click any trade for the contract's details, the stock's move and related news.</li></ul>''',
 [('Does options flow predict price moves?', 'Options flow shows what large traders are doing, not why. Many big trades are hedges or parts of spreads. It is most useful as context, combined with price action, open interest changes and repeated orders in the same contract.'),
  ('What does buying at the ask mean?', 'The trade printed at or above the ask price, so the buyer paid the full offer to get filled immediately. It suggests urgency and a buyer-initiated trade.'),
  ('Is options flow real time?', 'Exchange prints are published in real time to licensed feeds. On the data feed Options Screener currently uses, option trades can arrive about 15 minutes late; the app labels this on screen.')])

PAGES['unusual-options-activity'] = guide('/unusual-options-activity',
 'Unusual Options Activity: How to Find It and What It Means',
 'Unusual options activity: how to find it and what it means',
 'Unusual options activity explained: volume vs open interest, aggressive buying, short-dated out-of-the-money contracts, repeat orders, and a free scanner for US stocks.',
 "Unusual options activity is option trading that stands out from a contract's normal behaviour: far more volume than usual, more volume than open interest, or large aggressive orders in contracts that rarely trade. Traders watch it because informed money often moves through options first.",
 '''<h2>What traders look at</h2>
<h3>1. Volume far above open interest</h3>
<p>Open interest is the number of contracts still open from previous days. When today's volume is several times the open interest, new positions are being opened. A volume/OI ratio above 1 is the single most common unusual activity filter.</p>
<h3>2. Volume far above average</h3>
<p>A contract that normally trades 200 lots and suddenly trades 8,000 is unusual even if open interest is large. Compare today's volume with the contract's recent average.</p>
<h3>3. Aggressive side</h3>
<p>Trades at or above the ask (or at or below the bid) show urgency. A cluster of ask-side call sweeps is far more meaningful than the same volume printed mid-market.</p>
<h3>4. Short-dated, out-of-the-money contracts</h3>
<p>Buying cheap, out-of-the-money options that expire within days or weeks is a leveraged bet on a quick move. It costs little if wrong and pays many times over if right, which is why it shows up before news.</p>
<h3>5. Repeat orders</h3>
<p>The same contract bought again and again through the day, often in similar sizes, suggests one trader building a position.</p>
<h2>A simple checklist</h2>
<div class="tw"><table><thead><tr><th>Check</th><th>More notable</th><th>Less notable</th></tr></thead><tbody>
<tr><td>Volume / open interest</td><td>Above 2–3×</td><td>Below 1×</td></tr>
<tr><td>Premium</td><td>$500K+ in one name</td><td>Small, scattered lots</td></tr>
<tr><td>Side</td><td>At or above the ask</td><td>Mid-market</td></tr>
<tr><td>Expiry</td><td>Days to a few weeks</td><td>LEAPS (hedges, stock replacement)</td></tr>
<tr><td>Repetition</td><td>Same strike repeatedly</td><td>One-off print</td></tr>
<tr><td>Context</td><td>No obvious scheduled event</td><td>Right before earnings (expected)</td></tr>
</tbody></table></div>
<h2>Why it is not a guarantee</h2>
<p>Most unusual activity does not lead to a big move. Large orders may hedge a stock or futures position, be one leg of a spread, or close an older position. Earnings and other scheduled events naturally inflate volume. Treat unusual activity as a reason to look closer, not as a trade signal.</p>
<h2>Finding unusual activity in Options Screener</h2>
<ul><li>In the options flow, filter for size above open interest, ask-side trades and your minimum premium; repeat orders are counted per contract.</li>
<li>In the contract screener, use the unusual volume filter (volume above open interest) together with days to expiry and delta.</li>
<li>The option chain shows volume and open interest for every strike, so you can see where today's activity is concentrated.</li></ul>''',
 [('What is a good volume to open interest ratio?', "A ratio above 1 means today's volume exceeds all open contracts from previous days, which suggests new positions. Many traders look for 2–3× or more together with large premium and ask-side trades."),
  ('Does unusual options activity predict stock moves?', 'Sometimes, but not reliably. Many unusual trades are hedges or spreads. It is best used to find stocks worth a closer look.')])

PAGES['options-screener'] = guide('/options-screener',
 'Options Screener: Filter by Volume, Open Interest, IV, Delta',
 'How to use an options screener',
 'Filter every option contract by days to expiry, delta, volume, open interest, implied volatility and spread. A free options screener for US stocks.',
 'An options screener filters thousands of option contracts down to the few that match what you are looking for: the right expiry, the right delta, enough liquidity and the volatility you want. Here is how to set one up.',
 '''<h2>Why screen options?</h2>
<p>A single stock like SPY or NVDA can have thousands of listed contracts across dozens of expiries. Scrolling chains one expiry at a time misses most of them. A screener applies the same rules to every contract at once and ranks what is left.</p>
<h2>The filters that matter</h2>
<div class="tw"><table><thead><tr><th>Filter</th><th>Use it to</th><th>Typical setting</th></tr></thead><tbody>
<tr><td>Days to expiry (DTE)</td><td>Choose the time horizon</td><td>0–7 for short-term trades, 30–60 for swing trades, 180+ for LEAPS</td></tr>
<tr><td>Delta</td><td>Choose how far in or out of the money</td><td>0.30–0.50 for directional calls; 0.15–0.30 for premium selling</td></tr>
<tr><td>Volume</td><td>Make sure the contract trades today</td><td>100+ contracts</td></tr>
<tr><td>Open interest</td><td>Make sure there is depth</td><td>500+ contracts</td></tr>
<tr><td>Bid-ask spread %</td><td>Avoid contracts that are expensive to trade</td><td>Below 5–10% of the mid price</td></tr>
<tr><td>Implied volatility</td><td>Find cheap or rich options</td><td>Compare with the stock's usual IV</td></tr>
<tr><td>Unusual volume</td><td>Find new positioning</td><td>Volume above open interest</td></tr>
</tbody></table></div>
<h2>Example screens</h2>
<h3>Liquid swing-trade calls</h3>
<p>DTE 30–60, delta 0.40–0.60, volume above 500, open interest above 1,000, spread below 5%. Sort by volume.</p>
<h3>Short-term unusual activity</h3>
<p>DTE 0–14, unusual volume on, volume above 1,000. Sort by volume and compare with open interest.</p>
<h3>Premium selling candidates</h3>
<p>DTE 20–45, delta 0.15–0.30 (puts: −0.30 to −0.15), IV in the upper part of its range, spread below 5%.</p>
<h2>Liquidity first</h2>
<p>Whatever the strategy, start with liquidity. A contract with a wide spread or no open interest can be costly to enter and hard to exit. Volume, open interest and spread filters remove most of the contracts you should not trade anyway.</p>
<h2>The Options Screener contract screener</h2>
<ul><li>Screens every contract of a symbol across all expiries and strikes.</li>
<li>Filters: type, DTE range, delta range, minimum open interest, minimum volume, maximum spread %, IV range and unusual volume.</li>
<li>Sort by any column; click a contract for details and news, or star it to add it to your watchlist.</li>
<li>Save filter sets to your account and load them on any device.</li></ul>''',
 [('Is there a free options screener?', 'Yes. Options Screener has a free plan with option chains for up to 3 symbols a day. The full contract screener, options flow and charts are part of Pro at $9.99 a month.'),
  ('What is a good bid-ask spread for options?', "For liquid stocks and ETFs, spreads of a few cents or under 5% of the option's mid price are common. Wider spreads make the option more expensive to trade.")])

PAGES['option-chain'] = guide('/option-chain',
 'How to Read an Option Chain: Bid, Ask, OI, IV and Greeks',
 'How to read an option chain',
 'Learn to read an option chain: calls and puts, strikes, bid and ask, volume, open interest, implied volatility and delta. Free option chains for US stocks.',
 'An option chain lists every call and put for a stock, grouped by expiry and ordered by strike. Once you know what each column means, the chain tells you how the market prices risk, where traders are positioned and how liquid each contract is.',
 '''<h2>Layout</h2>
<p>Most chains show calls on the left and puts on the right, with the strike prices down the middle. You choose one expiry at a time. Strikes near the current stock price are <b>at the money</b>; calls below and puts above the stock price are <b>in the money</b>.</p>
<h2>The columns</h2>
<div class="tw"><table><thead><tr><th>Column</th><th>Meaning</th></tr></thead><tbody>
<tr><td>Bid / Ask</td><td>The best price buyers are paying and sellers are asking. You usually buy near the ask and sell near the bid.</td></tr>
<tr><td>Last</td><td>The price of the most recent trade. It may be stale for contracts that rarely trade; the bid and ask are more current.</td></tr>
<tr><td>Volume</td><td>Contracts traded today.</td></tr>
<tr><td>Open interest (OI)</td><td>Contracts still open from previous days. Updated once a day.</td></tr>
<tr><td>Implied volatility (IV)</td><td>The volatility the option price implies, as an annual percentage. Higher IV means more expensive options.</td></tr>
<tr><td>Delta (Δ)</td><td>How much the option price moves for a $1 move in the stock, and a rough probability of finishing in the money.</td></tr>
</tbody></table></div>
<h2>What to look for</h2>
<h3>Liquidity</h3>
<p>Narrow bid-ask spreads, high volume and high open interest mean you can get in and out at fair prices. Index ETFs like SPY and QQQ have the most liquid chains.</p>
<h3>Positioning</h3>
<p>Strikes with large open interest show where traders hold positions. Large volume today at a strike with little open interest shows new positioning.</p>
<h3>The volatility smile</h3>
<p>Plotting IV against strike usually gives a smile or a skew: out-of-the-money puts often carry higher IV than calls because investors pay for crash protection. A sudden rise in IV at one strike or expiry often comes before an event.</p>
<h3>Put/call ratios</h3>
<p>Dividing put volume (or open interest) by call volume gives a quick read on positioning for that expiry.</p>
<h2>Option chains in Options Screener</h2>
<ul><li>Full chains for every listed US stock and ETF with options, every expiry.</li>
<li>Bid, ask, last, volume, open interest, IV and delta for calls and puts, updating during market hours.</li>
<li>Put/call volume and open interest ratios and at-the-money IV at the top.</li>
<li>Star any contract to watch it; click any cell for contract details and news.</li>
<li>Free plan: up to 3 symbols a day.</li></ul>''',
 [('Why is the last price different from the bid and ask?', 'The last price is the most recent trade, which may have happened minutes or hours ago. The bid and ask show the current market.'),
  ('What is the difference between volume and open interest?', 'Volume counts contracts traded today. Open interest counts contracts that remain open from previous days and is updated once a day.')])

def sitemap():
    urls = [('/', '1.0', 'daily')] + [(p, '0.8', 'weekly') for p, _, _ in GUIDES] + [('/terms', '0.2', 'yearly'), ('/privacy', '0.2', 'yearly'), ('/refund', '0.2', 'yearly')]
    items = ''.join(f'<url><loc>{SITE}{u}</loc><lastmod>{TODAY}</lastmod><changefreq>{f}</changefreq><priority>{p}</priority></url>' for u, p, f in urls)
    return f'<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">{items}</urlset>\n'

ROBOTS = f'''User-agent: *
Allow: /
Disallow: /api/
Disallow: /admin
Disallow: /unsubscribe

Sitemap: {SITE}/sitemap.xml
'''

if __name__ == '__main__':
    for name, content in PAGES.items():
        (OUT / f'{name}.html').write_text(content)
    (OUT / 'sitemap.xml').write_text(sitemap())
    (OUT / 'robots.txt').write_text(ROBOTS)
    print('built', ', '.join(PAGES), '+ sitemap.xml, robots.txt')
