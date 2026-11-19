/** The board's one stylesheet: tokens for light and dark, then each part of the page top to bottom. */
export const CSS = `
:root{color-scheme:light dark;
--bg:#f7f7f5;--surface:#ffffff;--text:#18191b;--text-2:#55585e;--text-3:#7a7d84;--line:rgba(20,22,26,.08);--fill:rgba(20,22,26,.045);
--accent:#3651f0;--attn:#a14b08;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{
--bg:#101113;--surface:#17181b;--text:#ededee;--text-2:#a7aab1;--text-3:#7d8088;--line:rgba(255,255,255,.07);--fill:rgba(255,255,255,.045);
--accent:#8fa0ff;--attn:#f2a65e;--ok:#5bd38a}}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:16px/1.5 "Inter var",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Roboto,sans-serif;letter-spacing:-.011em;-webkit-font-smoothing:antialiased;font-feature-settings:"cv11","ss01"}
code{font:13px/1.4 ui-monospace,"Cascadia Mono",Consolas,monospace}
ul,ol{list-style:none}
#app{max-width:1280px;margin:0 auto;padding:24px 32px 64px}

.tab-radio{position:absolute;opacity:0;pointer-events:none}
.top{display:flex;align-items:center;justify-content:space-between;gap:16px 24px;flex-wrap:wrap;margin-bottom:32px}
.top h1{font-size:16px;font-weight:600;display:flex;align-items:baseline;gap:12px;min-width:0;flex:1 1 360px}
.top h1 .sub{font-weight:400;color:var(--text-3)}
.branch code{color:var(--text-3)}
.right{display:flex;align-items:center;gap:20px}
.stats{display:flex;gap:16px;align-items:center;color:var(--text-3);font-size:13px;font-variant-numeric:tabular-nums}
.stats b{color:var(--text-2);font-weight:600}
.stats .hot,.stats .hot b{color:var(--attn)}
.tabs{display:flex;gap:2px;padding:3px;background:var(--fill);border-radius:999px}
.tabs label{font-size:13px;font-weight:500;color:var(--text-2);padding:4px 14px;border-radius:999px;cursor:pointer;transition:background-color .15s,color .15s}
.tabs label:hover{color:var(--text)}
#tab-now:checked~.top label[for=tab-now],#tab-plan:checked~.top label[for=tab-plan]{background:var(--surface);color:var(--text);box-shadow:0 1px 2px rgba(0,0,0,.12)}
#tab-now:focus-visible~.top label[for=tab-now],#tab-plan:focus-visible~.top label[for=tab-plan]{outline:2px solid var(--accent);outline-offset:2px}
#tab-now:checked~.plan,#tab-plan:checked~.now{display:none}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--text-3);font-size:13px}
.live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--text-3)}
.live.on::before{background:var(--ok)}
.live.off::before{background:var(--attn)}
.notify{font:inherit;font-size:13px;color:var(--accent);background:none;border:0;cursor:pointer}

.hero{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:48px;padding:40px;border-radius:20px;background:var(--fill)}
.hero.working{background:color-mix(in srgb,var(--accent) 9%,var(--bg))}
.eyebrow{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-3);margin-bottom:12px}
.working .eyebrow{color:var(--accent)}
.working .eyebrow::before{content:"";width:8px;height:8px;border-radius:50%;background:currentColor}
.hero h2{font-size:clamp(28px,1.6vw + 16px,40px);line-height:1.15;font-weight:650;letter-spacing:-.025em;text-wrap:balance;max-width:24ch}
.hero .meta{margin-top:16px}
.hero .body{margin-top:16px;color:var(--text-2);max-width:60ch}
.hero .body li{padding:2px 0}
.hero .progress{margin-top:20px;max-width:360px}
.handoff{min-width:0;align-self:center}
.handoff h3{font-size:13px;font-weight:600;color:var(--text-3);margin-bottom:8px}
.handoff p{color:var(--text-2);white-space:pre-wrap;max-width:56ch;display:-webkit-box;-webkit-line-clamp:8;-webkit-box-orient:vertical;overflow:hidden}

.needs{margin-top:16px;padding:20px 24px;border-radius:16px;background:color-mix(in srgb,var(--attn) 11%,var(--bg))}
.needs h2{font-size:16px;font-weight:600;color:var(--attn);margin-bottom:4px}
.needs .row{border-color:color-mix(in srgb,var(--attn) 18%,transparent)}
.needs .row:last-child{border-bottom:0;padding-bottom:0}
.needs .kind{color:var(--attn);font-weight:500}
.aside{color:var(--text-3);font-size:13px;margin-top:12px}

.cols{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:56px;margin-top:40px}
.group+.group{margin-top:40px}
.group h3{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:600;color:var(--text-2);padding-bottom:8px}
.pill{display:inline-block;min-width:22px;padding:0 7px;border-radius:999px;background:var(--fill);color:var(--text-3);font-size:12px;font-weight:500;line-height:20px;text-align:center;font-variant-numeric:tabular-nums}
.group h4{font-size:13px;font-weight:500;color:var(--text-3);padding:16px 0 0}

.row{padding:12px 0;border-bottom:1px solid var(--line);transition:background-color 1.2s ease}
.row:last-child{border-bottom:0}
.row .title{line-height:1.4}
.row .note{color:var(--text-2);font-size:13px;margin-top:4px}
.fresh{background:color-mix(in srgb,var(--accent) 10%,transparent)!important;transition:none}
.meta{display:flex;flex-wrap:wrap;gap:4px 12px;align-items:baseline;margin-top:4px;color:var(--text-3);font-size:13px}
.meta .when{color:var(--text-3)}
.line{padding:6px 0;color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.empty{color:var(--text-3);padding:12px 0}

.queue{counter-reset:q var(--from,0)}
.queue .row{display:grid;grid-template-columns:28px minmax(0,1fr)}
.queue .row::before{counter-increment:q;content:counter(q);grid-row:span 3;color:var(--text-3);font-size:13px;line-height:1.75;font-variant-numeric:tabular-nums}

.progress{display:flex;align-items:center;gap:12px}
.bar{flex:1;height:6px;border-radius:999px;background:var(--fill);overflow:hidden}
.bar span{display:block;height:100%;border-radius:999px;background:var(--accent)}
.progress .num{font-size:13px;color:var(--text-3);font-variant-numeric:tabular-nums;min-width:4ch;text-align:right}
.project{border-bottom:1px solid var(--line)}
li:last-child>.project{border-bottom:0}
.project>summary{display:block;list-style:none;cursor:pointer;padding:12px 0;border-radius:8px}
.project>summary::-webkit-details-marker{display:none}
.pname{display:flex;align-items:baseline;gap:8px}
.pname::after{content:"";width:6px;height:6px;margin-left:auto;border-right:1.5px solid var(--text-3);border-bottom:1.5px solid var(--text-3);transform:translateY(-3px) rotate(45deg);transition:transform .15s}
.project[open] .pname::after{transform:translateY(0) rotate(-135deg)}
.project>summary:hover .pname{color:var(--accent)}
.project .progress{margin-top:8px}
.ptasks{padding:0 0 16px}
.ptask{display:flex;justify-content:space-between;align-items:baseline;gap:16px;padding:6px 0 6px 12px;border-left:2px solid var(--line);font-size:14px;color:var(--text-2)}
.ptask .st{flex:none;font-size:13px;color:var(--text-3)}
.ptask .st-now{color:var(--accent);font-weight:500}
.ptask .st-attn{color:var(--attn);font-weight:500}
.pdone{margin-top:8px}
.pdone>summary{cursor:pointer;font-size:13px;color:var(--text-3);padding:4px 0 4px 14px;list-style:none}
.pdone>summary::-webkit-details-marker{display:none}
.pdone>summary:hover{color:var(--text-2)}
.pdone .ptask{color:var(--text-3)}

.activity .act{display:grid;grid-template-columns:4.5em 5.5em minmax(0,1fr);gap:12px;padding:6px 0;font-size:13px;align-items:baseline}
.activity .act time,.activity .act .verb{color:var(--text-3);font-variant-numeric:tabular-nums}
.activity .act .what{color:var(--text-2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}

details.area{border-bottom:1px solid var(--line);padding:12px 0}
details.area:last-child{border-bottom:0}
details.area summary{cursor:pointer;display:flex;justify-content:space-between;gap:12px;list-style:none}
details.area summary::-webkit-details-marker{display:none}
details.area summary:hover{color:var(--accent)}
details.area summary .n{color:var(--text-3);font-size:13px;font-variant-numeric:tabular-nums;white-space:nowrap}
details.area .desc{color:var(--text-3);font-size:13px;margin-top:4px}
details.area ol{margin-top:12px;display:grid;gap:8px}
details.area ol li{padding-left:12px;border-left:2px solid var(--line)}
details.area .why{color:var(--text-2);font-size:13px}
details.area .why.missing{color:var(--attn)}
.kind{color:var(--text-3)}
.for{color:var(--text-3);font-weight:400}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

@media (max-width:1000px){#app{padding:16px 16px 48px}.hero{grid-template-columns:1fr;gap:24px;padding:28px 24px}.cols{grid-template-columns:1fr;gap:40px}.top{margin-bottom:24px}}
@media (prefers-reduced-motion:reduce){.row,.tabs label,.pname::after{transition:none}}
`;
