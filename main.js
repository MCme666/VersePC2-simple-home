/* ==========================================================================
 * Simple Home（简单主页）· VersePC2 功能插件主脚本
 *
 * 运行环境：由插件运行时 plugin-runtime.js 在"受限沙箱"内执行
 *   - window / self / globalThis 是受限代理（未授权能力会被拦截）
 *   - document 为启动器真实 document（可安全使用）
 *   - 直接复用启动器前端全局函数（doMemoryOptimize / cleanupScan / cleanupRun /
 *     refreshMemoryInfo / showToast），无需任何额外权限
 *
 * 交互效果（抽屉式）：
 *   1. 仅当处于「主页」(#page-home.active) 且主页滚动到顶部时，继续向下滚动鼠标滚轮
 *      / 触摸板下滑 / 触摸下滑 → 主内容区 .content-area 整体向上平移
 *      （transform: translateY(-var(--shp-reveal-h))，350ms ease-out），
 *      露出下方贴底固定的「简单主页」面板；
 *   2. 向上滚动 → 内容回落原位，面板收回（同时上移 translateY(100%)）；
 *   3. 关闭方式：上滑、点击右上角 ✕、点击半透明遮罩、Esc、切换到其它页面。
 *
 * 三大功能：
 *   1. 快捷网站：面板内展示启动器「工具箱」中的常用网站，点击用系统默认浏览器打开；
 *   2. 释放内存：复用启动器「设置 → 其他」的内存优化（doMemoryOptimize）；
 *   3. 清理游戏垃圾：复用启动器垃圾扫描 + 一键清理（cleanupScan → cleanupRun）。
 *
 * 设计约束：
 *   - 面板 UI 全部渲染在 Shadow DOM 内，样式隔离（仅继承启动器 CSS 变量保持观感一致）；
 *   - 仅在"已露出"且指针不在面板内时才 preventDefault（阻止底层页面跟着滚动），
 *     其余情况一律不拦截事件，不影响启动器原有功能；
 *   - 中英文双语（navigator.language 自动切换，可在面板内手动覆盖并持久化）；
 *   - 每一步都有降级与友好提示，插件自身异常不影响启动器。
 * ========================================================================== */
(function () {
  'use strict';

  /* ======================= 常量 ======================= */
  var PID = 'simple-home';
  var STYLE_ID = 'plugin-style-' + PID;   // 运行时注入 style.css 后生成的 <style> id
  var HOST_ID = 'shp-host';               // Shadow DOM 宿主（light DOM 中的唯一元素）
  var HOME_PAGE_ID = 'page-home';         // 页面容器（.page）
  var HOME_SEL = '.home-page';            // 主页内容根元素（Vue 渲染进 #page-home 内）
  var SHIFT_CLASS = 'shp-content-shift';  // 作用于 .content-area（内容整体上移）
  var BOUND_ATTR = 'data-shp-bound';      // 宿主上标记"监听已绑定"，防止重扫重复绑定
  var STORE_KEY = 'plugin_simple_home_config';

  var OPEN_THRESHOLD = 60;    // 顶部继续下滑累计量达到该值 → 露出面板（一次滚轮即触发）
  var CLOSE_THRESHOLD = 60;   // 上滑累计量达到该值 → 收回
  var GESTURE_WINDOW = 500;   // 手势累计有效时间窗（ms）
  var CLOSE_COOLDOWN = 600;   // 收回后的冷却期，避免刚收起又被带出

  /* ======================= 双语文案 ======================= */
  var I18N = {
    zh: {
      title: '简单主页',
      subtitle: '上滑收回 · 下滑展开',
      close: '关闭',
      memBtn: '释放内存',
      memBtnHint: '调用启动器内存优化',
      memBusy: '优化中…',
      cleanBtn: '清理游戏垃圾',
      cleanBtnHint: '扫描并清理日志 / 缓存',
      cleanBusy: '清理中…',
      memUsage: '内存使用率',
      memUnknown: '暂无数据（可在「设置 → 其他」查看实时占用）',
      search: '搜索网站…',
      empty: '没有匹配的网站',
      noApi: '当前启动器版本未提供该功能，请更新 VersePC2',
      memDone: '已执行内存优化',
      memFail: '内存优化失败：',
      cleanNone: '很干净，没有可清理的垃圾文件',
      cleanDone: '已执行游戏垃圾清理',
      cleanFail: '垃圾清理失败：',
      openFail: '无法在默认浏览器中打开，网址已复制到剪贴板',
      openFailNoClip: '无法打开链接：',
      gesture: '下滑展开',
      langAuto: '跟随系统',
      langZh: '中文',
      langEn: 'EN',
      hint: '提示：在主页向下滚动即可展开「简单主页」',
      gestureOff: '已关闭下滑展开（可在面板底部重新开启）'
    },
    en: {
      title: 'Simple Home',
      subtitle: 'Scroll up to hide · down to reveal',
      close: 'Close',
      memBtn: 'Free Memory',
      memBtnHint: 'Run launcher memory optimizer',
      memBusy: 'Optimizing…',
      cleanBtn: 'Clean Game Junk',
      cleanBtnHint: 'Scan & clean logs / caches',
      cleanBusy: 'Cleaning…',
      memUsage: 'Memory usage',
      memUnknown: 'No data (see Settings → Other for live stats)',
      search: 'Search sites…',
      empty: 'No matching site',
      noApi: 'This launcher version does not provide that feature',
      memDone: 'Memory optimization finished',
      memFail: 'Memory optimization failed: ',
      cleanNone: 'Nothing to clean — your game data is tidy',
      cleanDone: 'Game junk cleanup finished',
      cleanFail: 'Cleanup failed: ',
      openFail: 'Cannot open the browser; link copied to clipboard',
      openFailNoClip: 'Cannot open link: ',
      gesture: 'Swipe-down reveal',
      langAuto: 'Auto',
      langZh: '中文',
      langEn: 'EN',
      hint: 'Tip: scroll down on the Home page to reveal Simple Home',
      gestureOff: 'Swipe-down reveal disabled (re-enable at panel bottom)'
    }
  };

  /* 工具箱分类名的英文映射 */
  var CAT_EN = {
    '百科攻略': 'Wiki & Guides',
    '模组与整合包': 'Mods & Modpacks',
    '玩家社区': 'Community',
    '材质与光影': 'Resource Packs & Shaders',
    '地图与建筑': 'Maps & Builds',
    '在线工具': 'Online Tools',
    '皮肤资源': 'Skins',
    '服务器与插件': 'Servers & Plugins',
    '资源导航': 'Resource Directory',
    '其他': 'Others'
  };

  /* 兜底站点（读取不到工具箱模板时使用） */
  var FALLBACK_SITES = [
    { cat: '百科攻略', name: 'Minecraft Wiki', desc: '最权威的官方百科', url: 'https://zh.minecraft.wiki', domain: 'zh.minecraft.wiki' },
    { cat: '百科攻略', name: 'MC百科', desc: '中文 Mod 百科数据库', url: 'https://www.mcmod.cn', domain: 'mcmod.cn' },
    { cat: '模组与整合包', name: 'CurseForge', desc: '全球最大 Mod 整合包平台', url: 'https://www.curseforge.com/minecraft', domain: 'curseforge.com' },
    { cat: '模组与整合包', name: 'Modrinth', desc: '新兴开源 Mod 平台', url: 'https://modrinth.com', domain: 'modrinth.com' },
    { cat: '模组与整合包', name: 'MCBBS', desc: '国内最大 MC 中文论坛', url: 'https://www.mcbbs.co/forum.php', domain: 'mcbbs.co' },
    { cat: '模组与整合包', name: 'MCPEDL', desc: '基岩版资源大全', url: 'https://mcpedl.com', domain: 'mcpedl.com' },
    { cat: '玩家社区', name: 'MineBBS', desc: '国内 MC 中文论坛', url: 'https://www.minebbs.com', domain: 'minebbs.com' },
    { cat: '玩家社区', name: '苦力怕论坛', desc: '资源丰富的中文社区', url: 'https://klpbbs.com', domain: 'klpbbs.com' },
    { cat: '玩家社区', name: 'Bilibili MC', desc: '视频教程 / 实况 / 攻略', url: 'https://search.bilibili.com/all?keyword=我的世界', domain: 'bilibili.com' },
    { cat: '材质与光影', name: 'ResourcePack', desc: '海量材质包下载', url: 'https://resourcepack.net', domain: 'resourcepack.net' },
    { cat: '材质与光影', name: 'Vanilla Tweaks', desc: '原版微调增强包', url: 'https://vanillatweaks.net', domain: 'vanillatweaks.net' },
    { cat: '在线工具', name: 'Chunkbase', desc: '种子地图 / 结构定位', url: 'https://www.chunkbase.com', domain: 'chunkbase.com' },
    { cat: '在线工具', name: 'MCStacker', desc: '命令在线生成器', url: 'https://mcstacker.net', domain: 'mcstacker.net' },
    { cat: '在线工具', name: 'Misode', desc: '数据包 / 世界编辑器', url: 'https://misode.github.io', domain: 'misode.github.io' },
    { cat: '在线工具', name: 'mclo.gs', desc: '游戏日志分析工具', url: 'https://mclo.gs', domain: 'mclo.gs' },
    { cat: '皮肤资源', name: 'NameMC', desc: '正版皮肤 / UUID 查询', url: 'https://namemc.com', domain: 'namemc.com' },
    { cat: '皮肤资源', name: 'LittleSkin', desc: '国内皮肤站', url: 'https://littleskin.cn', domain: 'littleskin.cn' },
    { cat: '皮肤资源', name: 'Nova Skin', desc: '3D 皮肤编辑器', url: 'https://novaskin.me', domain: 'novaskin.me' },
    { cat: '服务器与插件', name: 'SpigotMC', desc: '服务器插件 / Paper 核心', url: 'https://www.spigotmc.org', domain: 'spigotmc.org' },
    { cat: '服务器与插件', name: '找服网', desc: '国内服务器大全', url: 'https://www.mczfw.com', domain: 'mczfw.com' },
    { cat: '资源导航', name: 'MCNav', desc: 'MC 资源大全一站导航', url: 'https://www.mcnav.net', domain: 'mcnav.net' },
    { cat: '资源导航', name: 'MinecraftXZ', desc: '中文资源下载站', url: 'https://www.minecraftxz.com', domain: 'minecraftxz.com' }
  ];

  /* style.css 注入失败时的最小可用样式，保证效果永远可呈现 */
  var FALLBACK_CSS = [
    ':root{--shp-reveal-h:clamp(300px,58vh,520px);}',
    '#shp-host{position:fixed;top:0;bottom:0;right:0;left:var(--sidebar-width,0px);z-index:9998;pointer-events:none;}',
    '.shp-content-shift{position:relative;z-index:2;animation:none !important;transform:translateY(0);transition:transform 350ms ease-out;}',
    '.shp-content-shift.is-revealed{transform:translateY(calc(-1 * var(--shp-reveal-h)));}',
    '.shp-mask{position:absolute;inset:0;background:rgba(0,0,0,.38);opacity:0;pointer-events:none;transition:opacity 350ms ease-out;}',
    '.shp-mask.is-open{opacity:1;pointer-events:auto;}',
    '.shp-panel{position:absolute;left:0;right:0;bottom:0;height:var(--shp-reveal-h);display:flex;flex-direction:column;overflow:hidden;transform:translateY(100%);pointer-events:none;color:var(--text-primary,#f3f3f5);background:var(--bg-secondary,#191a20);border-top:1px solid var(--border,rgba(255,255,255,.1));border-radius:18px 18px 0 0;transition:transform 350ms ease-out;}',
    '.shp-panel.is-open{transform:translateY(0);pointer-events:auto;}',
    '.shp-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px 10px;border-bottom:1px solid var(--border,rgba(255,255,255,.08));}',
    '.shp-logo{width:34px;height:34px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:var(--accent,#7c5cff);}',
    '.shp-title{font-size:15px;font-weight:600;}.shp-sub{font-size:11px;color:var(--text-muted,#9a9aa5);}',
    '.shp-icon-btn{width:30px;height:30px;border:none;border-radius:9px;cursor:pointer;background:var(--bg-hover,rgba(255,255,255,.08));color:inherit;}',
    '.shp-actions{display:grid;grid-template-columns:1fr 1fr;gap:10px;padding:12px 20px 4px;}',
    '.shp-act{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:pointer;text-align:left;font:inherit;color:inherit;background:var(--bg-secondary,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.1));border-radius:12px;}',
    '.shp-act:disabled{opacity:.6;cursor:progress;}',
    '.shp-act-ico{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:9px;background:var(--bg-active,rgba(255,255,255,.1));}',
    '.shp-act-txt{display:flex;flex-direction:column;}.shp-act-txt b{font-size:13px;}.shp-act-txt i{font-style:normal;font-size:11px;color:var(--text-muted,#9a9aa5);}',
    '.shp-mem{margin:10px 20px 0;padding:10px 12px;border-radius:12px;background:var(--bg-secondary,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));}',
    '.shp-mem-row{display:flex;justify-content:space-between;font-size:12px;}.shp-bar{height:6px;margin-top:6px;border-radius:999px;background:var(--bg-active,rgba(255,255,255,.1));}',
    '.shp-bar-fill{height:100%;width:0;border-radius:999px;background:var(--accent,#7c5cff);}.shp-mem-detail{margin-top:5px;font-size:11px;color:var(--text-muted,#9a9aa5);}',
    '.shp-search{padding:12px 20px 6px;}.shp-input{width:100%;box-sizing:border-box;padding:8px 12px;font:inherit;font-size:13px;color:inherit;background:var(--bg-secondary,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.1));border-radius:10px;outline:none;}',
    '.shp-sites{flex:1;min-height:60px;overflow-y:auto;padding:6px 20px 12px;}',
    '.shp-cat{margin:10px 0 6px;font-size:11px;font-weight:600;color:var(--text-muted,#9a9aa5);}',
    '.shp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px;}',
    '.shp-site{display:flex;align-items:center;gap:9px;padding:8px 10px;cursor:pointer;text-align:left;font:inherit;color:inherit;background:var(--bg-secondary,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.08));border-radius:10px;}',
    '.shp-fav{position:relative;flex:none;width:26px;height:26px;border-radius:7px;overflow:hidden;display:flex;align-items:center;justify-content:center;font-weight:700;color:#fff;background:var(--accent,#7c5cff);}',
    '.shp-fav-img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;}',
    '.shp-meta{display:flex;flex-direction:column;min-width:0;flex:1;}.shp-meta b{font-size:12.5px;}.shp-meta i{font-style:normal;font-size:10.5px;color:var(--text-muted,#9a9aa5);}',
    '.shp-go{font-size:12px;color:var(--text-muted,#9a9aa5);}.shp-empty{padding:24px 0;text-align:center;font-size:12px;color:var(--text-muted,#9a9aa5);}',
    '.shp-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 20px 14px;border-top:1px solid var(--border,rgba(255,255,255,.08));}',
    '.shp-switch{display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;}',
    '.shp-lang{display:flex;gap:4px;}.shp-lang button{padding:4px 9px;font:inherit;font-size:11px;cursor:pointer;border-radius:999px;color:inherit;background:var(--bg-secondary,rgba(255,255,255,.04));border:1px solid var(--border,rgba(255,255,255,.1));}',
    '.shp-lang button.is-active{color:#fff;background:var(--accent,#7c5cff);border-color:var(--accent,#7c5cff);}'
  ].join('\n');

  /* ======================= 运行时状态 ======================= */
  var cfg = { gesture: true, lang: 'auto', hinted: false, debug: false };
  var lang = 'zh';
  var host = null, shadow = null, panel = null, mask = null;
  var contentEl = null;          // 需要整体上移的元素（.content-area）
  var homeEl = null;             // #page-home
  var sitesBox = null, searchInput = null;
  var sites = [];
  var isOpen = false;
  var cssSource = 'fallback';   // style.css 还是内置兜底样式
  var lastCloseAt = 0;
  var acc = 0, accDir = 0, accTime = 0;
  var busy = { memory: false, clean: false };

  /* ======================= 基础工具 ======================= */
  function t(key) {
    var d = I18N[lang] || I18N.zh;
    if (d[key] !== undefined) return d[key];
    if (I18N.zh[key] !== undefined) return I18N.zh[key];
    return key;
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function errText(e) {
    if (!e) return '';
    if (e.message) return e.message;
    return String(e);
  }

  /* 统一提示：优先用启动器 toast，没有则退回控制台，绝不抛错 */
  function toast(msg, type) {
    try {
      showToast(String(msg), type || 'info');
    } catch (e) {
      try { console.warn('[SimpleHome] ' + msg); } catch (_) { /* noop */ }
    }
  }

  function hostOf(url) {
    var m = /^https?:\/\/([^/?#]+)/i.exec(String(url || ''));
    return m ? m[1] : '';
  }

  function detectLang() {
    var l = 'en';
    try {
      var nl = String(navigator.language || navigator.userLanguage || '').toLowerCase();
      l = nl.indexOf('zh') === 0 ? 'zh' : 'en';
    } catch (e) { l = 'zh'; }
    return l;
  }

  function applyLang() {
    lang = (cfg.lang === 'zh' || cfg.lang === 'en') ? cfg.lang : detectLang();
  }

  /* ======================= 配置持久化（window.bridge.store） ======================= */
  function loadConfig(cb) {
    var done = false;
    function finish(v) {
      if (done) return;
      done = true;
      try {
        var o = (typeof v === 'string') ? JSON.parse(v) : v;
        /* 默认开启下滑展开：忽略历史持久化的关闭值，避免误关后再也唤不出面板。
           面板底部的开关仍可在本次会话内临时关闭（重启即恢复开启）。 */
        cfg.gesture = true;
        if (o && typeof o === 'object') {
          if (o.lang === 'auto' || o.lang === 'zh' || o.lang === 'en') cfg.lang = o.lang;
          if (typeof o.hinted === 'boolean') cfg.hinted = o.hinted;
          if (typeof o.debug === 'boolean') cfg.debug = o.debug;
        }
      } catch (e) { /* 配置损坏则使用默认值 */ }
      applyLang();
      cb();
    }
    try {
      var p = window.bridge.store.get(STORE_KEY);
      Promise.resolve(p).then(finish).catch(function () { finish(null); });
    } catch (e) {
      finish(null);
    }
  }

  function saveConfig() {
    try { window.bridge.store.set(STORE_KEY, JSON.stringify(cfg)); } catch (e) { /* 忽略写入失败 */ }
  }

  /* ======================= 网站数据：优先解析启动器「工具箱」模板 ======================= */
  function parseToolbox() {
    try {
      var tpl = window.VersePC && window.VersePC.PageToolbox && window.VersePC.PageToolbox.template;
      if (!tpl || typeof DOMParser === 'undefined') return null;
      var doc = new DOMParser().parseFromString('<div>' + tpl + '</div>', 'text/html');
      var sections = doc.querySelectorAll('.toolbox-section');
      if (!sections || !sections.length) return null;
      var out = [];
      for (var i = 0; i < sections.length; i++) {
        var sec = sections[i];
        var catEl = sec.querySelector('.toolbox-category');
        var cat = catEl ? String(catEl.textContent || '').trim() : '';
        var cards = sec.querySelectorAll('.toolbox-card');
        for (var j = 0; j < cards.length; j++) {
          var card = cards[j];
          var oc = String(card.getAttribute('onclick') || '');
          var m = /openExternal\(\s*['"]([^'"]+)['"]\s*\)/.exec(oc);
          if (!m) continue;
          var url = m[1];
          var img = card.querySelector('.toolbox-icon');
          var domain = img ? String(img.getAttribute('data-domain') || '') : '';
          var nameEl = card.querySelector('.toolbox-name');
          var descEl = card.querySelector('.toolbox-desc');
          out.push({
            cat: cat,
            url: url,
            domain: domain || hostOf(url),
            name: nameEl ? String(nameEl.textContent || '').trim() : hostOf(url),
            desc: descEl ? String(descEl.textContent || '').trim() : ''
          });
        }
      }
      return out.length ? out : null;
    } catch (e) {
      return null;
    }
  }

  function buildSites() {
    var parsed = parseToolbox();
    if (parsed) {
      sites = parsed;
      return true;
    }
    sites = FALLBACK_SITES.slice();
    return false;
  }

  function faviconUrl(domain) {
    if (!domain) return '';
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(domain) + '&sz=64';
  }

  function siteSubtitle(s) {
    if (lang === 'zh') return s.desc || s.domain || hostOf(s.url);
    return s.domain || hostOf(s.url);
  }

  function catName(cat) {
    if (lang === 'zh') return cat || t('langZh');
    return CAT_EN[cat] || cat || 'Others';
  }

  /* ======================= Shadow DOM 构建 ======================= */
  function panelHTML() {
    return [
      '<div class="shp-mask" data-shp="mask"></div>',
      '<div class="shp-panel" role="dialog" aria-label="Simple Home">',
      '  <div class="shp-head">',
      '    <div class="shp-brand">',
      '      <div class="shp-logo">SH</div>',
      '      <div>',
      '        <div class="shp-title" data-shp="title"></div>',
      '        <div class="shp-sub" data-shp="subtitle"></div>',
      '      </div>',
      '    </div>',
      '    <button type="button" class="shp-icon-btn" data-shp="close" aria-label="close">&#10005;</button>',
      '  </div>',

      '  <div class="shp-actions">',
      '    <button type="button" class="shp-act shp-act-primary" data-shp="memory">',
      '      <span class="shp-act-ico">&#9889;</span>',
      '      <span class="shp-act-txt"><b data-shp="memBtn"></b><i data-shp="memHint"></i></span>',
      '    </button>',
      '    <button type="button" class="shp-act" data-shp="clean">',
      '      <span class="shp-act-ico">&#129529;</span>',
      '      <span class="shp-act-txt"><b data-shp="cleanBtn"></b><i data-shp="cleanHint"></i></span>',
      '    </button>',
      '  </div>',

      '  <div class="shp-mem">',
      '    <div class="shp-mem-row"><span data-shp="memLabel"></span><span class="shp-mem-val" data-shp="memVal">--</span></div>',
      '    <div class="shp-bar"><div class="shp-bar-fill" data-shp="memFill"></div></div>',
      '    <div class="shp-mem-detail" data-shp="memDetail"></div>',
      '  </div>',

      '  <div class="shp-search">',
      '    <input type="text" class="shp-input" data-shp="search" autocomplete="off" spellcheck="false">',
      '  </div>',
      '  <div class="shp-sites" data-shp="sites"></div>',

      '  <div class="shp-foot">',
      '    <label class="shp-switch"><input type="checkbox" data-shp="gesture"><span data-shp="gestureLabel"></span></label>',
      '    <div class="shp-lang">',
      '      <button type="button" data-shp="lang" data-lang="auto"></button>',
      '      <button type="button" data-shp="lang" data-lang="zh"></button>',
      '      <button type="button" data-shp="lang" data-lang="en"></button>',
      '    </div>',
      '  </div>',
      '</div>'
    ].join('');
  }

  function q(sel) { return shadow.querySelector(sel); }
  function qs(name) { return shadow.querySelector('[data-shp="' + name + '"]'); }

  /* 幂等：运行时每次重扫都会重新执行本脚本。
     若宿主已存在则复用（运行时不会清理它），返回 false 表示"非首次创建"。 */
  function createUI(cssText) {
    var exist = document.getElementById(HOST_ID);
    if (exist && exist.shadowRoot && exist.shadowRoot.querySelector('.shp-panel')) {
      host = exist;
      shadow = exist.shadowRoot;
      panel = q('.shp-panel');
      mask = q('.shp-mask');
      sitesBox = qs('sites');
      searchInput = qs('search');
      applyTexts();
      renderSites(searchInput ? String(searchInput.value || '') : '');
      return false;
    }
    if (exist) { try { exist.remove(); } catch (e) { /* noop */ } }  // 残损宿主则重建

    host = document.createElement('div');
    host.id = HOST_ID;
    document.body.appendChild(host);
    shadow = host.attachShadow({ mode: 'open' });

    var styleEl = document.createElement('style');
    styleEl.textContent = cssText || FALLBACK_CSS;
    shadow.appendChild(styleEl);

    var wrap = document.createElement('div');
    wrap.innerHTML = panelHTML();
    while (wrap.firstChild) shadow.appendChild(wrap.firstChild);

    panel = q('.shp-panel');
    mask = q('.shp-mask');
    sitesBox = qs('sites');
    searchInput = qs('search');

    bindUI();
    applyTexts();
    renderSites('');
    return true;
  }

  function bindUI() {
    qs('close').addEventListener('click', function () { close(); });
    qs('mask').addEventListener('click', function () { close(); });
    qs('memory').addEventListener('click', function () { runMemory(); });
    qs('clean').addEventListener('click', function () { runClean(); });

    searchInput.addEventListener('input', function () {
      renderSites(String(searchInput.value || ''));
    });

    var gestureBox = qs('gesture');
    gestureBox.addEventListener('change', function () {
      cfg.gesture = !!gestureBox.checked;
      saveConfig();
      toast(cfg.gesture ? t('gesture') : t('gestureOff'), 'info');
    });

    var langBtns = shadow.querySelectorAll('[data-shp="lang"]');
    for (var i = 0; i < langBtns.length; i++) {
      (function (btn) {
        btn.addEventListener('click', function () {
          cfg.lang = btn.getAttribute('data-lang') || 'auto';
          saveConfig();
          applyLang();
          applyTexts();
          renderSites(searchInput ? String(searchInput.value || '') : '');
        });
      })(langBtns[i]);
    }

    /* Esc 关闭；仅在面板展开时生效 */
    document.addEventListener('keydown', function (e) {
      if (!isOpen) return;
      if (e.key === 'Escape' || e.key === 'Esc') close();
    });

    /* 点击侧边栏导航等（离开主页）时自动收回 */
    document.addEventListener('click', function (e) {
      if (!isOpen) return;
      var tg = e.target;
      if (tg && typeof tg.closest === 'function') {
        if (tg.closest('.nav-btn, .nav-sub-btn, .sidebar-toggle-fab')) { close(); return; }
      }
      /* 点击面板/遮罩之外（如左上区域）也收回 */
      if (!fromPanel(e)) close();
    }, true);
  }

  /* 把双语文案写进已渲染的 DOM */
  function applyTexts() {
    function set(name, text) { var el = qs(name); if (el) el.textContent = text; }
    set('title', t('title'));
    set('subtitle', t('subtitle'));
    set('memBtn', busy.memory ? t('memBusy') : t('memBtn'));
    set('memHint', t('memBtnHint'));
    set('cleanBtn', busy.clean ? t('cleanBusy') : t('cleanBtn'));
    set('cleanHint', t('cleanBtnHint'));
    set('memLabel', t('memUsage'));
    set('gestureLabel', t('gesture'));
    if (searchInput) searchInput.placeholder = t('search');
    qs('close').setAttribute('aria-label', t('close'));

    var btns = shadow.querySelectorAll('[data-shp="lang"]');
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var v = b.getAttribute('data-lang');
      b.textContent = (v === 'auto') ? t('langAuto') : (v === 'zh' ? t('langZh') : t('langEn'));
      if (v === cfg.lang) b.className = 'is-active'; else b.className = '';
    }
    var gb = qs('gesture');
    if (gb) gb.checked = !!cfg.gesture;
  }

  /* ======================= 网站列表渲染 ======================= */
  function renderSites(filter) {
    if (!sitesBox) return;
    var kw = String(filter || '').trim().toLowerCase();
    var html = '';
    var lastCat = null;
    var shown = 0;

    for (var i = 0; i < sites.length; i++) {
      var s = sites[i];
      if (kw) {
        var hay = (s.name + ' ' + s.desc + ' ' + s.domain + ' ' + s.url + ' ' + s.cat).toLowerCase();
        if (hay.indexOf(kw) < 0) continue;
      }
      var cat = s.cat || t('langZh');
      if (cat !== lastCat) {
        if (lastCat !== null) html += '</div>';
        html += '<div class="shp-cat">' + esc(catName(cat)) + '</div><div class="shp-grid">';
        lastCat = cat;
      }
      html += siteHTML(s);
      shown++;
    }
    if (lastCat !== null) html += '</div>';
    if (!shown) html = '<div class="shp-empty">' + esc(t('empty')) + '</div>';

    sitesBox.innerHTML = html;

    var items = sitesBox.querySelectorAll('.shp-site');
    for (var j = 0; j < items.length; j++) {
      (function (el) {
        el.addEventListener('click', function () {
          openUrl(el.getAttribute('data-url') || '');
        });
      })(items[j]);
    }

    /* 图标加载失败（离线/CSP）→ 隐藏图片，露出首字母兜底 */
    var imgs = sitesBox.querySelectorAll('.shp-fav-img');
    for (var k = 0; k < imgs.length; k++) {
      (function (img) {
        img.addEventListener('error', function () { img.style.display = 'none'; });
      })(imgs[k]);
    }
  }

  function siteHTML(s) {
    var initial = String(s.name || s.domain || '?').trim().charAt(0).toUpperCase();
    var fav = faviconUrl(s.domain || hostOf(s.url));
    return '<button type="button" class="shp-site" data-url="' + esc(s.url) + '" title="' + esc(s.url) + '">' +
      '<span class="shp-fav">' +
        (fav ? '<img class="shp-fav-img" src="' + esc(fav) + '" alt="" loading="lazy">' : '') +
        '<span>' + esc(initial) + '</span>' +
      '</span>' +
      '<span class="shp-meta"><b>' + esc(s.name) + '</b><i>' + esc(siteSubtitle(s)) + '</i></span>' +
      '<span class="shp-go">&#8599;</span>' +
    '</button>';
  }

  /* ======================= 打开外部链接 ======================= */
  function openUrl(url) {
    if (!url) return;
    var br = null;
    try { br = window.bridge; } catch (e) { br = null; }

    if (!br || typeof br.openExternal !== 'function') {
      toast(t('openFailNoClip') + url, 'error');
      return;
    }
    Promise.resolve()
      .then(function () { return br.openExternal(url); })
      .catch(function (e) {
        /* 降级：复制网址到剪贴板，提示用户手动打开 */
        try {
          if (br.clipboard && typeof br.clipboard.writeText === 'function') {
            Promise.resolve(br.clipboard.writeText(url)).catch(function () {});
          }
        } catch (_) { /* noop */ }
        toast(t('openFail'), 'error');
        try { console.warn('[SimpleHome] openExternal failed:', errText(e)); } catch (_) { /* noop */ }
      });
  }

  /* ======================= 功能 2：释放内存 ======================= */
  function setBusy(key, on) {
    busy[key] = !!on;
    var btn = qs(key === 'memory' ? 'memory' : 'clean');
    if (btn) btn.disabled = !!on;
    if (key === 'memory') {
      var mb = qs('memBtn'); if (mb) mb.textContent = on ? t('memBusy') : t('memBtn');
    } else {
      var cb = qs('cleanBtn'); if (cb) cb.textContent = on ? t('cleanBusy') : t('cleanBtn');
    }
  }

  function refreshMemory() {
    /* 复用启动器前端的内存刷新逻辑（会更新 #memory-usage-* 元素） */
    try { if (typeof refreshMemoryInfo === 'function') refreshMemoryInfo(); } catch (e) { /* noop */ }

    setTimeout(function () {
      var valEl = qs('memVal');
      var fillEl = qs('memFill');
      var detEl = qs('memDetail');
      var srcText = document.getElementById('memory-usage-text');
      var srcDet = document.getElementById('memory-detail-text');

      var pct = srcText ? String(srcText.textContent || '').trim() : '';
      var ok = pct && /%/.test(pct);
      if (valEl) valEl.textContent = ok ? pct : '--';
      if (fillEl) fillEl.style.width = ok ? pct : '0%';
      if (detEl) {
        var d = srcDet ? String(srcDet.textContent || '').trim() : '';
        detEl.textContent = (d && d.indexOf('正在获取') < 0) ? d : t('memUnknown');
      }
    }, 400);
  }

  function runMemory() {
    if (busy.memory) return;
    if (typeof doMemoryOptimize !== 'function') { toast(t('noApi'), 'error'); return; }
    setBusy('memory', true);
    Promise.resolve()
      .then(function () { return doMemoryOptimize(); })
      .then(function () { toast(t('memDone'), 'success'); })
      .catch(function (e) { toast(t('memFail') + errText(e), 'error'); })
      .then(function () { setBusy('memory', false); refreshMemory(); });
  }

  /* ======================= 功能 3：清理游戏垃圾 ======================= */
  function runClean() {
    if (busy.clean) return;
    if (typeof cleanupScan !== 'function') { toast(t('noApi'), 'error'); return; }
    setBusy('clean', true);
    Promise.resolve()
      .then(function () { return cleanupScan(); })
      .then(function () {
        /* 扫描结果写回启动器的「一键清理」按钮；按钮仍禁用说明没有可清理内容 */
        var runBtn = document.getElementById('cleanup-run-btn');
        if (runBtn && runBtn.disabled) { toast(t('cleanNone'), 'info'); return null; }
        if (typeof cleanupRun !== 'function') { toast(t('noApi'), 'error'); return null; }
        return cleanupRun();
      })
      .then(function (r) { if (r !== null) toast(t('cleanDone'), 'success'); })
      .catch(function (e) { toast(t('cleanFail') + errText(e), 'error'); })
      .then(function () { setBusy('clean', false); });
  }

  /* ======================= 展开 / 收回 ======================= */
  function prepareContentShift() {
    /* 优先平移整个内容区 .content-area；逐级退化，保证一定能找到可平移的容器 */
    contentEl = document.querySelector('.content-area') ||
                document.getElementById(HOME_PAGE_ID) ||
                document.querySelector('.main-container') ||
                document.getElementById('app');
    if (!contentEl) return false;
    contentEl.classList.add(SHIFT_CLASS);
    return true;
  }

  function open() {
    if (isOpen || !contentEl || !panel) return;
    isOpen = true;
    contentEl.classList.add('is-revealed');            // 主内容整体上移
    panel.classList.add('is-open');                    // 面板从底部滑出
    mask.classList.add('is-open');                     // 遮罩淡入
    dbg('open()：内容上移 + 面板露出');
    refreshMemory();
  }

  function close() {
    if (!isOpen || !contentEl || !panel) return;
    isOpen = false;
    lastCloseAt = Date.now();
    contentEl.classList.remove('is-revealed');
    panel.classList.remove('is-open');
    mask.classList.remove('is-open');
  }

  function toggle() { if (isOpen) close(); else open(); }

  /* ======================= 主页识别：动态多信号扫描 =======================
     启动器里"当前是主页"由三处共同标识（实时查询，绝不缓存，避免 Vue 重渲染后失效）：
       a. 侧边栏按钮  <button class="nav-btn active" data-page="home">   ← navigateToPage 维护，最权威
       b. 页面容器    #page-home.page.active
       c. 主页根元素  #page-home > .home-page（Vue 渲染）
     任一信号成立即判定"处于主页"，命中的信号会写入 debug().signal 便于排查。 */
  function homeRoot() {
    return document.querySelector('#page-home ' + HOME_SEL) || document.querySelector(HOME_SEL);
  }

  function activePageName() {
    var a = document.querySelector('.page.active');
    return a ? (a.id || a.className) : 'none';
  }

  /* 从 .home-page 往上找最近的 overflow:auto/scroll 祖先（通常即 #page-home） */
  function resolveScroller(root) {
    var node = root;
    if (!node) return null;
    node = node.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      var oy = '';
      try {
        if (typeof getComputedStyle === 'function') oy = String(getComputedStyle(node).overflowY || '');
      } catch (e) { oy = ''; }
      if (oy === 'auto' || oy === 'scroll') return node;
      node = node.parentElement;
    }
    return null;
  }

  function scanHome() {
    var out = {
      ok: false, signal: '', activePage: '', navActive: false,
      root: null, scroller: null, scrollTop: -1, atTop: true
    };

    var navActive = document.querySelector('.nav-btn.active[data-page="home"]');
    out.navActive = !!navActive;

    var active = document.querySelector('.page.active');
    out.activePage = active ? (active.id || active.className) : 'none';

    var pageHome = document.getElementById(HOME_PAGE_ID);
    var root = homeRoot();
    out.root = root || null;

    /* 优先级：侧边栏按钮状态 > 页面容器 active > 活动页含 .home-page */
    if (out.navActive) {
      out.ok = true; out.signal = 'nav-btn.active[data-page=home]';
    } else if (pageHome && pageHome.classList.contains('active')) {
      out.ok = true; out.signal = '#page-home.active';
    } else if (root && active && (active === root || active.contains(root))) {
      out.ok = true; out.signal = '.page.active > ' + HOME_SEL;
    } else if (root && !active) {
      out.ok = true; out.signal = HOME_SEL + '（无活动页，按主页处理）';
    } else {
      out.signal = 'not-home';
    }

    out.scroller = resolveScroller(root) || pageHome;
    if (out.scroller) {
      try {
        out.scrollTop = out.scroller.scrollTop || 0;
        out.atTop = (out.scroller.scrollHeight <= out.scroller.clientHeight + 4) ? true : out.scrollTop <= 2;
      } catch (e) { out.atTop = true; }
    }
    return out;
  }

  function onHomePage() { return scanHome().ok; }
  function homeScroller() { var s = scanHome(); return s.scroller; }
  function scrollTopValue() { return scanHome().scrollTop; }
  function atScrollTop() { return scanHome().atTop; }

  /* 指针是否位于主页内容区域：避免在侧边栏等区域滚动时误触发 */
  function inHomeRegion(e) {
    var tg = e.target;
    if (!tg || tg === document || tg === document.documentElement || tg === document.body) return true;
    if (fromPanel(e)) return true;
    try {
      var area = document.querySelector('.content-area');
      if (area && area.contains(tg)) return true;
      var root = homeRoot();
      if (root && (root === tg || root.contains(tg))) return true;
    } catch (err) { return true; }
    return false;
  }

  function fromPanel(e) {
    if (!host) return false;
    try {
      if (e.composedPath) {
        var p = e.composedPath();
        for (var i = 0; i < p.length; i++) if (p[i] === host) return true;
      }
      return e.target === host;
    } catch (err) {
      return false;
    }
  }

  function isFormField(e) {
    var tg = e.target;
    if (!tg || typeof tg.closest !== 'function') return false;
    try { return !!tg.closest('input, textarea, select'); } catch (err) { return false; }
  }

  /* 只打印一次的诊断日志：下滑没反应时可直接看启动器控制台（侧边栏「日志」） */
  var _logged = {};
  function logOnce(key, msg) {
    if (_logged[key]) return;
    _logged[key] = true;
    try { console.warn('[SimpleHome] ' + msg); } catch (e) { /* noop */ }
  }

  /* 逐条日志（VersePC.SimpleHome.setDebug(true) 打开）：把每次滚轮的判定过程打全 */
  function dbg(msg) {
    if (!cfg.debug) return;
    try { console.log('[SimpleHome] ' + msg); } catch (e) { /* noop */ }
  }

  function targetName(e) {
    try {
      var tg = e.target;
      if (!tg) return 'null';
      if (tg === document) return '#document';
      return (tg.id ? '#' + tg.id : '') + (tg.className ? '.' + String(tg.className).split(' ')[0] : '') || tg.nodeName;
    } catch (err) { return '?'; }
  }

  function onWheel(e) {
    if (e.__shpHandled) return;      // 同一事件可能同时命中主页元素监听与 document 兜底监听
    e.__shpHandled = 1;

    if (!panel || !contentEl) return;
    ensureHomeBound();               // 主页元素被 Vue 重建时自愈重绑
    if (isFormField(e)) return;
    if (!cfg.gesture) {
      logOnce('gesture-off', '下滑展开已关闭：可在面板底部「' + t('gesture') + '」重新开启');
      return;
    }

    var d = e.deltaY;
    if (!d) return;
    var now = Date.now();

    /* 已展开：遮住内容区的滚动（面板内部列表仍可正常滚动） */
    if (isOpen) {
      dbg('wheel(已展开) d=' + d + ' target=' + targetName(e) + ' inPanel=' + fromPanel(e));
      if (!fromPanel(e) && typeof e.preventDefault === 'function') e.preventDefault();
      if (d < 0) {
        if ((now - accTime) > GESTURE_WINDOW || accDir > 0) acc = 0;
        accTime = now; accDir = d; acc += d;
        if (acc <= -CLOSE_THRESHOLD) { acc = 0; close(); }
      } else {
        acc = 0;
      }
      return;
    }

    /* 未展开：仅在「主页」且滚动到顶部、指针位于主页内容区时，继续下滑才展开 */
    var snap = scanHome();
    dbg('wheel d=' + d + ' target=' + targetName(e) +
        ' home=' + snap.ok + '(' + snap.signal + ') atTop=' + snap.atTop +
        ' region=' + inHomeRegion(e) + ' acc0=' + acc + ' cooldown=' + (now - lastCloseAt));
    if (!snap.ok) {
      logOnce('not-home', '当前不在主页，忽略下滑（活动页：' + snap.activePage + '，侧边栏主页按钮 active：' + snap.navActive + '，主页根元素：' + (snap.root ? HOME_SEL : '未找到') + '）');
      acc = 0; return;
    }
    if (!snap.atTop) {
      logOnce('not-top', '主页尚未滚动到最顶部，忽略下滑（scrollTop=' + snap.scrollTop + '）');
      acc = 0; return;
    }
    if (!inHomeRegion(e)) {
      logOnce('outside', '指针不在主页内容区（如在侧边栏上滚动），忽略下滑');
      acc = 0; return;
    }
    if (d > 0) {
      if ((now - accTime) > GESTURE_WINDOW || accDir < 0) acc = 0;
      accTime = now; accDir = d; acc += d;
      if (acc >= OPEN_THRESHOLD && (now - lastCloseAt) > CLOSE_COOLDOWN) { acc = 0; open(); }
    } else {
      acc = 0;
    }
  }

  var touchY = 0, touchT = 0, touchOn = false;
  function onTouchStart(e) {
    if (e.__shpHandled) return;
    e.__shpHandled = 1;
    if (!e.touches || !e.touches.length) return;
    touchY = e.touches[0].clientY;
    touchT = Date.now();
    touchOn = true;
  }
  function onTouchMove(e) {
    if (e.__shpHandled) return;
    e.__shpHandled = 1;
    if (!touchOn || !cfg.gesture || !panel) return;
    if (!e.touches || !e.touches.length) return;
    var dy = e.touches[0].clientY - touchY;
    if (Date.now() - touchT > 900) { touchY = e.touches[0].clientY; touchT = Date.now(); return; }
    if (isOpen) {
      if (dy < -60) { touchOn = false; close(); }
    } else {
      var snap = scanHome();
      if (snap.ok && snap.atTop && dy > 60 && (Date.now() - lastCloseAt) > CLOSE_COOLDOWN) { touchOn = false; open(); }
    }
  }

  /* 直接把监听绑到「主页滚动容器」上：只有主页内的滚动才会命中，天然满足"仅主页" */
  var homeBoundEl = null;
  function ensureHomeBound() {
    var el = scanHome().scroller || document.getElementById(HOME_PAGE_ID);
    if (!el || el === homeBoundEl) return;
    if (!el.__shpWheelBound) {
      el.__shpWheelBound = 1;
      el.addEventListener('wheel', onWheel, { passive: false });
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: true });
    }
    homeBoundEl = el;
  }

  function bindGesture() {
    /* document 兜底：面板区域（不在主页容器内）的上滑收回、以及主页容器尚未就绪时 */
    document.addEventListener('wheel', onWheel, { passive: false, capture: true });
    document.addEventListener('touchstart', onTouchStart, { passive: true });
    document.addEventListener('touchmove', onTouchMove, { passive: true });
    /* 快捷键 Ctrl+Alt+H：手势开关关闭或失效时仍可唤出面板 */
    document.addEventListener('keydown', function (e) {
      if (e.ctrlKey && e.altKey && (e.key === 'h' || e.key === 'H')) {
        try { e.preventDefault(); } catch (_) { /* noop */ }
        toggle();
      }
    });
    ensureHomeBound();
  }

  /* 离开主页（切页）时自动收回，避免内容停在位移状态 */
  function watchHomePage() {
    if (!homeEl) homeEl = document.getElementById(HOME_PAGE_ID);
    if (!homeEl || typeof MutationObserver === 'undefined') return;
    try {
      new MutationObserver(function () {
        if (!isOpen) return;
        if (!onHomePage()) close();
      }).observe(homeEl, { attributes: true, attributeFilter: ['class'] });
    } catch (e) { /* noop */ }
  }

  /* ======================= 样式获取 ======================= */
  /* 运行时先执行 main.js 再注入 style.css，这里轮询等待 <style id="plugin-style-simple-home"> */
  function getCss(cb) {
    var tries = 0;
    (function poll() {
      var el = null;
      try { el = document.getElementById(STYLE_ID); } catch (e) { el = null; }
      if (el && el.textContent && el.textContent.length > 20) { cssSource = 'style.css'; cb(el.textContent); return; }
      if (++tries > 40) { cssSource = 'fallback'; cb(FALLBACK_CSS); return; }   // 最多等 4s，超时用内置兜底样式
      setTimeout(poll, 100);
    })();
  }

  /* ======================= 入口 ======================= */
  function boot() {
    loadConfig(function () {
      var fromToolbox = buildSites();

      getCss(function (cssText) {
        var fresh = createUI(cssText);          // 复用旧宿主时返回 false
        var okShift = prepareContentShift();    // 无论新旧都必须保证内容区可平移
        if (!okShift) {
          try { console.error('[SimpleHome] 未找到 .content-area / #page-home，无法平移，面板不会展开'); } catch (e) { /* noop */ }
          return;
        }

        /* 只在首次（或宿主被重建）时绑定全局监听，避免运行时重扫导致重复绑定 */
        if (fresh || host.getAttribute(BOUND_ATTR) !== '1') {
          bindGesture();
          watchHomePage();
          try { host.setAttribute(BOUND_ATTR, '1'); } catch (e) { /* noop */ }
        }
        ensureHomeBound();   // 每次执行都重新定位主页容器并按需绑定（Vue 重建后自愈）
        refreshMemory();

        /* 对外暴露开关与诊断信息：控制台执行 VersePC.SimpleHome.debug() 可自检 */
        try {
          window.VersePC = window.VersePC || {};
          window.VersePC.SimpleHome = {
            open: open, close: close, toggle: toggle,
            isOpen: function () { return isOpen; },
            rescan: function () { ensureHomeBound(); prepareContentShift(); return scanHome(); },
            /* 手势开关（持久化）：VersePC.SimpleHome.setGesture(true) */
            setGesture: function (on) {
              cfg.gesture = !!on;
              saveConfig();
              var gb = qs('gesture'); if (gb) gb.checked = cfg.gesture;
              toast(cfg.gesture ? t('gesture') : t('gestureOff'), 'info');
              return cfg.gesture;
            },
            /* 逐条滚轮日志：setDebug(true) 后每次滚轮都会打印判定过程 */
            setDebug: function (on) { cfg.debug = !!on; saveConfig(); return cfg.debug; },
            /* 恢复默认：手势开启 + 语言跟随系统 */
            resetConfig: function () {
              cfg.gesture = true; cfg.lang = 'auto'; cfg.hinted = true;
              saveConfig(); applyLang(); applyTexts();
              var gb = qs('gesture'); if (gb) gb.checked = true;
              renderSites(searchInput ? String(searchInput.value || '') : '');
              return true;
            },
            debug: function () {
              var s = scanHome();
              return {
                host: !!host, panel: !!panel, bound: !!(host && host.getAttribute(BOUND_ATTR) === '1'),
                contentEl: contentEl ? (contentEl.id || contentEl.className) : null,
                revealed: contentEl ? contentEl.classList.contains('is-revealed') : false,
                onHomePage: s.ok, signal: s.signal, activePage: s.activePage, navHomeActive: s.navActive,
                homeRoot: !!s.root,
                scroller: s.scroller ? (s.scroller.id || s.scroller.className) : null,
                wheelBoundOn: homeBoundEl ? (homeBoundEl.id || homeBoundEl.className) : null,
                scrollTop: s.scrollTop, atTop: s.atTop,
                gestureEnabled: cfg.gesture, lang: lang, sites: sites.length, css: cssSource
              };
            }
          };
        } catch (e) { /* noop */ }

        try {
          var s0 = scanHome();
          console.info('[SimpleHome] 就绪：主页信号=' + s0.signal +
            '，滚动容器=' + (s0.scroller ? (s0.scroller.id || s0.scroller.className) : '未找到') +
            '；仅主页且滚动到顶部时下滑展开');
          if (!cfg.gesture) {
            console.warn('[SimpleHome] 下滑展开当前为「关闭」（已持久化）。开启：控制台执行 VersePC.SimpleHome.setGesture(true)，或打开面板勾选底部「' + t('gesture') + '」；也可用 Ctrl+Alt+H 唤出面板');
          }
        } catch (e) { /* noop */ }

        /* 首次安装后提示一次，之后不再打扰 */
        if (!cfg.hinted) {
          cfg.hinted = true;
          saveConfig();
          setTimeout(function () { toast(t('hint'), 'info'); }, 1200);
        }
        if (!fromToolbox) {
          try { console.info('[SimpleHome] 未读取到工具箱模板，使用内置网站列表'); } catch (e) { /* noop */ }
        }
      });
    });
  }

  try {
    boot();
  } catch (e) {
    try { console.error('[SimpleHome] 初始化失败', e); } catch (_) { /* noop */ }
  }
})();
