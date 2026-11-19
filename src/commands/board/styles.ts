/**
 * The board's one stylesheet. One family, four sizes (12, 13, 14, 16), spacing on a 4px grid. Emphasis comes
 * from weight and colour, not size. Blue means in progress, amber means it needs you; everything else is grey.
 */
export const CSS = `
:root{color-scheme:light dark;
--bg:#fbfbfa;--s1:#f3f3f1;--s2:#ebebe8;--line:rgba(20,22,26,.07);--line2:rgba(20,22,26,.12);
--t1:#1a1b1e;--t2:#5a5d64;--t3:#868991;--accent:#4353e0;--attn:#b05a0c;--ok:#15803d}
@media (prefers-color-scheme:dark){:root{
--bg:#0f1012;--s1:#17181b;--s2:#1e1f23;--line:rgba(255,255,255,.06);--line2:rgba(255,255,255,.11);
--t1:#ececee;--t2:#a3a6ad;--t3:#73767e;--accent:#8492ff;--attn:#f0a35c;--ok:#5bd38a}}
*{box-sizing:border-box;margin:0;padding:0}
ul,ol{list-style:none}
body{background:var(--bg);color:var(--t1);font:14px/1.5 "Inter var",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI Variable Text","Segoe UI",Roboto,sans-serif;letter-spacing:-.006em;-webkit-font-smoothing:antialiased}
#app{max-width:880px;margin:0 auto;padding:24px 24px 80px}
.t2{color:var(--t2)}.t3{color:var(--t3)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:4px}

/* Icons: shapes carry the state; colour repeats it. */
.ic{flex:none;display:block}
.k-t2{stroke:var(--t2)}.k-t3{stroke:var(--t3)}.k-t2f{fill:var(--t2)}
.k-acc{stroke:var(--accent)}.k-accf{fill:var(--accent)}.k-attn{stroke:var(--attn)}.k-attnf{fill:var(--attn)}.k-bg{stroke:var(--bg)}
.ring{flex:none;display:block}.ring-track{stroke:var(--line2)}.ring-fill{stroke:var(--accent)}

/* Top line and tabs */
.tab-radio{position:absolute;opacity:0;pointer-events:none}
.top{display:flex;align-items:center;gap:12px 16px;flex-wrap:wrap;margin-bottom:24px}
.top h1{display:flex;align-items:baseline;gap:8px;font-size:14px;font-weight:600;min-width:0;flex:1}
.branch{font-size:12px;font-weight:400;color:var(--t3)}
.right{display:flex;align-items:center;gap:16px;font-size:13px}
.hot{color:var(--attn)}.hot b{font-weight:600}
.tabs{display:flex;gap:2px}
.tabs label{font-size:13px;color:var(--t2);padding:4px 10px;border-radius:6px;cursor:pointer}
.tabs label:hover{color:var(--t1)}
#tab-board:checked~.top label[for=tab-board],#tab-history:checked~.top label[for=tab-history]{background:var(--s2);color:var(--t1)}
#tab-board:focus-visible~.top label[for=tab-board],#tab-history:focus-visible~.top label[for=tab-history]{outline:2px solid var(--accent);outline-offset:2px}
#tab-board:checked~.tab-history,#tab-history:checked~.tab-board{display:none}
.live{display:inline-flex;align-items:center;gap:6px;color:var(--t3)}
.live::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--t3)}
.live.on::before{background:var(--ok)}.live.off::before{background:var(--attn)}
.notify{font:inherit;color:var(--accent);background:none;border:0;cursor:pointer}

/* The focus card */
.focus{padding:16px 20px;border:1px solid var(--line2);border-radius:10px;background:var(--s1);margin-bottom:24px}
.focus.working{border-color:color-mix(in srgb,var(--accent) 40%,transparent);background:color-mix(in srgb,var(--accent) 7%,var(--s1))}
.fl{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:13px}
.fl .lbl{font-weight:600;color:var(--t2);margin-right:4px}
.working .fl .lbl{color:var(--accent)}
.fl .prog{display:inline-flex;align-items:center;gap:6px}
.ft{font-size:16px;font-weight:600;line-height:1.4;margin:8px 0 0 22px;text-wrap:pretty}
.handoff{font-size:13px;color:var(--t2);margin:8px 0 0 22px;max-width:72ch;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pulse{font-size:12px;color:var(--t3);margin:12px 0 0 22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

/* Status groups */
.g{margin-top:8px}
.g>summary,.projects h3{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--s1);border-radius:6px;font-size:13px;list-style:none}
.g>summary{cursor:pointer}
.g>summary::-webkit-details-marker{display:none}
.g>summary b{font-weight:600}
.g.attn>summary b{color:var(--attn)}
.c{color:var(--t3);font-weight:400;font-size:12px;font-variant-numeric:tabular-nums}
.g>summary::after,.project>summary::after{content:"";width:5px;height:5px;margin:0 2px 2px auto;border-right:1.5px solid var(--t3);border-bottom:1.5px solid var(--t3);transform:rotate(45deg)}
.g:not([open])>summary::after,.project:not([open])>summary::after{transform:rotate(-45deg);margin-bottom:0}

/* Rows: one size for every task */
.r{display:flex;align-items:flex-start;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);transition:background-color 1.2s ease}
.r .ic{margin-top:3px}
.r .body{flex:1;min-width:0}
.r .tt{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.r .note{font-size:12px;color:var(--t2);margin-top:2px}
.r .m{flex:none;font-size:12px;color:var(--t3);margin-top:2px;font-variant-numeric:tabular-nums}
.r .kind{flex:none;font-size:12px;color:var(--t3);width:56px;margin-top:1px}
.chip{flex:none;font-size:12px;color:var(--t2);background:var(--s2);padding:0 8px;border-radius:999px;line-height:20px;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fresh{background:color-mix(in srgb,var(--accent) 12%,transparent)!important;transition:none}
.more>summary{cursor:pointer;list-style:none;font-size:13px;color:var(--t3);padding:10px 12px 10px 38px}
.more>summary::-webkit-details-marker{display:none}
.more>summary:hover{color:var(--t2)}
.empty{color:var(--t3);font-size:13px;padding:10px 12px 10px 38px}

/* Projects */
.projects{margin-top:32px}
.projects h3{font-weight:600}
.project>summary{display:flex;align-items:center;gap:12px;padding:10px 12px;border-bottom:1px solid var(--line);cursor:pointer;list-style:none}
.project>summary::-webkit-details-marker{display:none}
.project>summary:hover .pn{color:var(--accent)}
.pn{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.project>ul{margin-left:16px;border-left:1px solid var(--line2)}

/* History */
.act{display:grid;grid-template-columns:5em 6.5em minmax(0,1fr);gap:12px;padding:8px 12px;border-bottom:1px solid var(--line);font-size:13px}
.act time,.act .verb{color:var(--t3);font-variant-numeric:tabular-nums}
.act .what{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
details.area{padding:10px 12px;border-bottom:1px solid var(--line)}
details.area summary{display:flex;justify-content:space-between;gap:12px;cursor:pointer;list-style:none}
details.area summary::-webkit-details-marker{display:none}
details.area .desc{font-size:12px;color:var(--t3);margin-top:4px}
details.area ol{margin-top:8px;display:grid;gap:8px}
details.area ol li{padding-left:12px;border-left:2px solid var(--line2);font-size:13px}
details.area .why{font-size:12px;color:var(--t2)}
details.area .why.missing{color:var(--attn)}

@media (max-width:640px){#app{padding:16px 12px 64px}.chip{display:none}.ft,.handoff,.pulse{margin-left:0}}
@media (prefers-reduced-motion:reduce){.r{transition:none}}
`;
