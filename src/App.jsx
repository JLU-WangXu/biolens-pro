import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Sun, Layers, Maximize, Upload, Download, Zap, Droplet, Box, 
  AlertCircle, Play, Pause, Grid, Scissors, Eye, Disc, Activity, Monitor, Ghost,
  MessageSquare, Mic, Send, Share2, RefreshCw, Search, Terminal, Cpu, Sparkles, Brain, Palette
} from 'lucide-react';

// --- 配置区 ---
// 建议在环境变量中设置，或者直接填入你的 Key
const GEMINI_API_KEY = ""; 
const DEFAULT_PDB = "4HHB";

// --- 动态脚本加载辅助 ---
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) { resolve(); return; }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const loadStyle = (href) => {
  if (document.querySelector(`link[href="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
};

const BioLens = () => {
  // --- Refs ---
  const containerRef = useRef(null);
  const pluginRef = useRef(null);
  const messagesEndRef = useRef(null);
  
  // --- State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdbIdInput, setPdbIdInput] = useState("");
  const [currentPdbId, setCurrentPdbId] = useState(DEFAULT_PDB);
  const [statusMsg, setStatusMsg] = useState("System Initializing...");
  
  // 可视化参数
  const [currentStyle, setCurrentStyle] = useState('cartoon'); 
  const [colorMode, setColorMode] = useState('chain-id'); 
  const [customColor, setCustomColor] = useState("#4f46e5");
  const [showWater, setShowWater] = useState(false);
  const [showHetero, setShowHetero] = useState(true);

  // AI 聊天
  const [aiInput, setAiInput] = useState("");
  const [isAiProcessing, setIsAiProcessing] = useState(false);
  const [aiHistory, setAiHistory] = useState([
    {role: 'system', text: 'BioLens AI 核心已就绪。请输入 PDB ID 或直接与我对话。'}
  ]);

  // --- 1. 初始化 Mol* ---
  useEffect(() => {
    const initViewer = async () => {
      try {
        setLoading(true);
        setStatusMsg("Loading Mol* Engine...");
        loadStyle("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css");
        await loadScript("https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js");
        
        if (!window.molstar) throw new Error("Mol* 引擎加载失败，请检查网络");

        // 防止全屏请求报错
        if (containerRef.current) {
          containerRef.current.requestFullscreen = () => Promise.resolve();
        }

        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          layoutShowLog: false,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
          viewportShowAnimation: true,
        });
        
        pluginRef.current = viewer;
        
        // 初始加载默认结构
        await loadPdbById(DEFAULT_PDB);
        setLoading(false);
      } catch (e) {
        console.error("Init Error:", e);
        setError(`初始化失败: ${e.message}`);
        setLoading(false);
      }
    };

    initViewer();

    return () => {
      if (pluginRef.current) {
        pluginRef.current.dispose();
      }
    };
  }, []);

  // --- 2. 核心：视觉渲染应用函数 (修复交互的关键) ---
  const applyVisuals = useCallback(async () => {
    const plugin = pluginRef.current;
    if (!plugin) return;

    setStatusMsg("Applying Visuals...");
    const { builders } = plugin;
    const structures = plugin.managers.structure.hierarchy.current.structures;

    if (structures.length === 0) return;
    const structureRef = structures[0];

    try {
      // 使用 Mol* 的数据事务（Transaction）一次性完成更新
      await plugin.dataTransaction(async () => {
        // 1. 清除当前所有组件（重新构建是最稳定的方式）
        for (const comp of structureRef.components) {
          await plugin.managers.structure.hierarchy.remove([comp]);
        }

        // 2. 构建聚合物 (Protein/DNA)
        const polymer = await builders.structure.tryCreateComponentStatic(structureRef.cell, 'polymer', 'Polymer');
        if (polymer) {
          let typeName = 'cartoon';
          if (currentStyle === 'surface') typeName = 'molecular-surface';
          if (currentStyle === 'ball-stick') typeName = 'ball-and-stick';
          if (currentStyle === 'spacefill') typeName = 'spacefill';
          if (currentStyle === 'putty') typeName = 'putty';
          if (currentStyle === 'wireframe') typeName = 'line';

          const colorTheme = colorMode === 'uniform' 
            ? { name: 'uniform', params: { value: parseInt(customColor.replace('#', ''), 16) } }
            : { name: colorMode };

          await builders.structure.representation.addRepresentation(polymer, { 
            type: typeName, 
            color: colorTheme.name,
            colorParams: colorTheme.params
          });
        }

        // 3. 构建配体 (Ligands/Hetero)
        if (showHetero) {
          const ligand = await builders.structure.tryCreateComponentStatic(structureRef.cell, 'ligand', 'Ligands');
          if (ligand) {
            await builders.structure.representation.addRepresentation(ligand, { 
              type: 'ball-and-stick', 
              color: 'element-symbol' 
            });
          }
        }

        // 4. 构建水分母
        if (showWater) {
          const water = await builders.structure.tryCreateComponentStatic(structureRef.cell, 'water', 'Water');
          if (water) {
            await builders.structure.representation.addRepresentation(water, { 
              type: 'ball-and-stick', 
              color: 'uniform',
              colorParams: { value: 0x4fc3f7 },
              typeParams: { alpha: 0.5, sizeFactor: 0.2 }
            });
          }
        }
      });
      setStatusMsg("Ready.");
    } catch (e) {
      console.error("Visual Apply Error:", e);
      setStatusMsg("Update Error");
    }
  }, [currentStyle, colorMode, customColor, showWater, showHetero]);

  // 监听参数变化并更新
  useEffect(() => {
    if (!loading && !error) {
      applyVisuals();
    }
  }, [currentStyle, colorMode, customColor, showWater, showHetero, applyVisuals]);

  // --- 3. 数据加载函数 ---
  const loadPdbById = async (id) => {
    const plugin = pluginRef.current;
    if (!plugin) return;
    
    setLoading(true);
    setStatusMsg(`Fetching ${id}...`);
    try {
      await plugin.clear();
      const url = `https://files.rcsb.org/download/${id.toLowerCase()}.pdb`;
      const data = await plugin.builders.data.download({ url });
      const trajectory = await plugin.builders.structure.parseTrajectory(data, 'pdb');
      await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default');
      
      setCurrentPdbId(id.toUpperCase());
      setLoading(false);
      // 加载完成后手动触发一次视觉刷新以应用当前 UI 的 Style
      setTimeout(applyVisuals, 500);
    } catch (e) {
      setError(`无法加载 PDB ${id}: ${e.message}`);
      setLoading(false);
    }
  };

  const handleFileUpload = async (e) => {
    const file = e.target.files[0];
    if (!file || !pluginRef.current) return;
    
    setLoading(true);
    setStatusMsg(`Parsing ${file.name}...`);
    try {
      await pluginRef.current.clear();
      const isBinary = file.name.endsWith('.bcif');
      const reader = new FileReader();
      
      reader.onload = async (ev) => {
        const data = await pluginRef.current.builders.data.rawData({ 
          data: ev.target.result, 
          label: file.name 
        });
        const trajectory = await pluginRef.current.builders.structure.parseTrajectory(data, isBinary ? 'bcif' : 'pdb');
        await pluginRef.current.builders.structure.hierarchy.applyPreset(trajectory, 'default');
        
        setCurrentPdbId("LOCAL");
        setLoading(false);
        setTimeout(applyVisuals, 500);
      };
      
      if (isBinary) reader.readAsArrayBuffer(file);
      else reader.readAsText(file);
    } catch (e) {
      setError("文件读取失败");
      setLoading(false);
    }
  };

  // --- 4. AI & Gemini 交互 ---
  const callGemini = async (prompt) => {
    if (!GEMINI_API_KEY) return "请在代码中配置您的 Gemini API Key。";
    try {
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }]
        })
      });
      const data = await response.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || "Gemini 未返回有效数据。";
    } catch (e) {
      return "连接 Gemini 失败。";
    }
  };

  const handleAiCommand = async (e) => {
    e.preventDefault();
    if (!aiInput.trim()) return;

    const userInput = aiInput;
    setAiInput("");
    setAiHistory(prev => [...prev, {role: 'user', text: userInput}]);
    setIsAiProcessing(true);

    const systemPrompt = `
      You are BioLens AI. You control a 3D molecule viewer.
      Current Settings: Style=${currentStyle}, ColorMode=${colorMode}, Water=${showWater}.
      User Input: "${userInput}"
      
      If the user wants to change visuals, return a JSON object (no markdown):
      {"updates": {"currentStyle": "surface|cartoon|ball-stick|spacefill", "colorMode": "chain-id|element-symbol|uniform", "showWater": true|false}, "message": "Applying changes..."}
      
      Otherwise, return:
      {"message": "Your scientific explanation here."}
      Return ONLY raw JSON.
    `;

    const rawResponse = await callGemini(systemPrompt);
    try {
      const jsonStr = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
      const data = JSON.parse(jsonStr);

      if (data.updates) {
        if (data.updates.currentStyle) setCurrentStyle(data.updates.currentStyle);
        if (data.updates.colorMode) setColorMode(data.updates.colorMode);
        if (data.updates.showWater !== undefined) setShowWater(data.updates.showWater);
      }
      setAiHistory(prev => [...prev, {role: 'system', text: data.message}]);
    } catch (err) {
      setAiHistory(prev => [...prev, {role: 'system', text: rawResponse}]);
    }
    setIsAiProcessing(false);
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  // --- 5. 渲染布局 ---
  return (
    <div className="flex flex-col h-screen w-full bg-slate-900 text-white font-sans overflow-hidden">
      
      {/* 顶部工具栏 */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-950 border-b border-slate-800 z-30 shadow-2xl">
        <div className="flex items-center gap-3">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <Cpu className="text-white" size={22} />
          </div>
          <h1 className="text-xl font-black tracking-tighter">BIOLENS <span className="text-indigo-500 text-sm ml-1 font-mono">v2.0</span></h1>
        </div>

        <div className="flex items-center gap-4">
          {/* PDB 获取框 */}
          <div className="flex items-center bg-slate-800 rounded-lg p-1 border border-slate-700">
            <Search size={16} className="ml-2 text-slate-400" />
            <input 
              className="bg-transparent border-none outline-none px-3 py-1 text-sm w-24 font-bold uppercase placeholder:text-slate-600"
              placeholder="PDB ID"
              value={pdbIdInput}
              onChange={e => setPdbIdInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && loadPdbById(pdbIdInput)}
            />
            <button 
              onClick={() => loadPdbById(pdbIdInput)}
              className="bg-indigo-600 hover:bg-indigo-500 px-4 py-1 rounded-md text-xs font-bold transition-all"
            >
              FETCH
            </button>
          </div>

          <label className="flex items-center gap-2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-600 rounded-lg cursor-pointer transition-all text-xs font-bold">
            <Upload size={14} /> LOCAL
            <input type="file" onChange={handleFileUpload} className="hidden" accept=".pdb,.cif,.bcif" />
          </label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Mol* 视口 */}
        <main className="flex-1 relative bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-slate-800 to-slate-950">
           {loading && (
             <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-900/60 backdrop-blur-md">
               <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
               <p className="text-indigo-400 font-mono text-sm animate-pulse">{statusMsg}</p>
             </div>
           )}
           
           <div ref={containerRef} className="absolute inset-0 w-full h-full" />

           {/* AI 悬浮对话框 */}
           <div className="absolute bottom-6 left-6 z-40 w-80 pointer-events-none">
              <div className="bg-slate-950/90 border border-slate-800 rounded-2xl shadow-2xl overflow-hidden pointer-events-auto flex flex-col max-h-[400px]">
                <div className="p-3 border-b border-slate-800 bg-slate-900/50 flex items-center gap-2">
                   <Sparkles size={16} className="text-indigo-400" />
                   <span className="text-xs font-bold text-slate-300">BioLens AI Assistant</span>
                </div>
                <div className="flex-1 overflow-y-auto p-4 space-y-3 custom-scrollbar text-[11px]">
                  {aiHistory.map((msg, i) => (
                    <div key={i} className={`${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                      <span className={`inline-block px-3 py-2 rounded-xl ${msg.role === 'user' ? 'bg-indigo-600 text-white' : 'bg-slate-800 text-slate-300 border border-slate-700'}`}>
                        {msg.text}
                      </span>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </div>
                <form onSubmit={handleAiCommand} className="p-3 bg-slate-900">
                  <div className="relative">
                    <input 
                      className="w-full bg-slate-950 border border-slate-700 rounded-full py-2 px-4 pr-10 text-xs focus:ring-2 focus:ring-indigo-500 outline-none"
                      placeholder="Ask BioLens anything..."
                      value={aiInput}
                      onChange={e => setAiInput(e.target.value)}
                    />
                    <button type="submit" className="absolute right-2 top-1.5 text-indigo-500">
                      {isAiProcessing ? <RefreshCw className="animate-spin" size={16}/> : <Send size={16}/>}
                    </button>
                  </div>
                </form>
              </div>
           </div>
        </main>

        {/* 右侧控制面板 */}
        <aside className="w-72 bg-slate-950 border-l border-slate-800 p-5 z-40 flex flex-col gap-8 shadow-[-10px_0_30px_rgba(0,0,0,0.5)] overflow-y-auto">
           
           <section>
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[2px] mb-4 flex items-center gap-2">
                <Layers size={14} /> Representation
              </h3>
              <div className="grid grid-cols-2 gap-2">
                {['cartoon', 'surface', 'ball-stick', 'putty', 'spacefill', 'wireframe'].map(s => (
                  <button 
                    key={s}
                    onClick={() => setCurrentStyle(s)}
                    className={`py-2 rounded-lg text-[10px] font-bold border transition-all uppercase
                    ${currentStyle === s ? 'bg-indigo-600 border-indigo-400 text-white' : 'bg-slate-900 border-slate-800 text-slate-500 hover:border-slate-600'}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
           </section>

           <section>
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[2px] mb-4 flex items-center gap-2">
                <Palette size={14} /> Color Engine
              </h3>
              <select 
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-2.5 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                value={colorMode}
                onChange={e => setColorMode(e.target.value)}
              >
                <option value="chain-id">Chain ID</option>
                <option value="element-symbol">Atom Element</option>
                <option value="residue-name">Residue Type</option>
                <option value="hydrophobicity">Hydrophobicity</option>
                <option value="uniform">Uniform Custom</option>
              </select>

              {colorMode === 'uniform' && (
                <div className="mt-4 p-3 bg-slate-900 rounded-xl border border-slate-800">
                  <p className="text-[10px] text-slate-500 mb-2 uppercase font-bold">Pick Color</p>
                  <div className="flex items-center gap-3">
                    <input 
                      type="color" 
                      className="w-10 h-10 bg-transparent cursor-pointer rounded-md overflow-hidden border-none"
                      value={customColor}
                      onChange={e => setCustomColor(e.target.value)}
                    />
                    <span className="text-xs font-mono text-slate-400">{customColor.toUpperCase()}</span>
                  </div>
                </div>
              )}
           </section>

           <section>
              <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-[2px] mb-4 flex items-center gap-2">
                <Activity size={14} /> Visibility
              </h3>
              <div className="space-y-3">
                <Toggle label="Solvent (H2O)" active={showWater} onClick={() => setShowWater(!showWater)} color="text-blue-400" />
                <Toggle label="Hetero-atoms" active={showHetero} onClick={() => setShowHetero(!showHetero)} color="text-emerald-400" />
              </div>
           </section>

           <div className="mt-auto border-t border-slate-800 pt-5">
              <button 
                onClick={() => pluginRef.current?.managers.camera.reset()}
                className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-slate-400 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 border border-slate-800"
              >
                <RefreshCw size={14} /> RESET CAMERA
              </button>
           </div>

        </aside>
      </div>
    </div>
  );
};

// 辅助组件：开关按钮
const Toggle = ({ label, active, onClick, color }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all
    ${active ? 'bg-slate-900 border-slate-700' : 'bg-slate-950 border-transparent opacity-50'}`}
  >
    <span className="text-xs font-bold text-slate-400">{label}</span>
    <div className={`w-2 h-2 rounded-full shadow-[0_0_8px_rgba(0,0,0,0.5)] ${active ? color.replace('text', 'bg') : 'bg-slate-800'}`} />
  </button>
);

export default BioLens;
