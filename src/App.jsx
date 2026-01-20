import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Layers, Upload, Download, Search, Cpu, Sparkles, Palette, 
  Activity, Send, AlertCircle, RefreshCw, Eye, Box
} from 'lucide-react';

// --- 配置区 ---
const GEMINI_API_KEY = ""; 
const DEFAULT_ID = "4HHB";

const BioLensFinal = () => {
  // --- Refs ---
  const containerRef = useRef(null);
  const pluginRef = useRef(null);
  
  // --- 系统状态 ---
  const [isInitializing, setIsInitializing] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [errorDetails, setErrorDetails] = useState(null);
  const [currentId, setCurrentId] = useState(DEFAULT_ID);
  const [searchPdb, setSearchPdb] = useState("");

  // --- 视觉同步状态 (交互核心) ---
  const [reprStyle, setReprStyle] = useState('cartoon'); // cartoon, molecular-surface, ball-and-stick, spacefill
  const [colorTheme, setColorTheme] = useState('chain-id'); // chain-id, element-symbol, hydrophobicity, uniform
  const [hexColor, setHexColor] = useState("#4f46e5");
  const [showWater, setShowWater] = useState(false);
  const [showHetero, setShowHetero] = useState(true);

  // --- 1. 核心视觉引擎：确保画风正确 ---
  const syncVisuals = useCallback(async () => {
    const ctx = pluginRef.current;
    if (!ctx) return;

    // 获取当前结构
    const structures = ctx.managers.structure.hierarchy.current.structures;
    if (structures.length === 0) return;

    const struct = structures[0];
    
    try {
      setIsBusy(true);
      // 使用数据事务：确保清除和创建是原子操作，防止中途报错
      await ctx.dataTransaction(async () => {
        // 1. 清理现有所有显示组件
        for (const comp of struct.components) {
          await ctx.managers.structure.hierarchy.remove([comp]);
        }

        // 2. 创建聚合物 (Protein/DNA)
        const polymer = await ctx.builders.structure.tryCreateComponentStatic(struct.cell, 'polymer');
        if (polymer) {
          const colorParams = colorTheme === 'uniform' 
            ? { name: 'uniform', params: { value: parseInt(hexColor.replace('#', ''), 16) } }
            : { name: colorTheme };

          await ctx.builders.structure.representation.addRepresentation(polymer, { 
            type: reprStyle, 
            color: colorParams.name,
            colorParams: colorParams.params,
            typeParams: { quality: 'auto', alpha: 1.0 }
          });
        }

        // 3. 创建配体/异质原子
        if (showHetero) {
          const ligands = await ctx.builders.structure.tryCreateComponentStatic(struct.cell, 'ligand');
          if (ligands) {
            await ctx.builders.structure.representation.addRepresentation(ligands, { 
              type: 'ball-and-stick', 
              color: 'element-symbol',
              typeParams: { sizeFactor: 0.3 }
            });
          }
        }

        // 4. 创建水
        if (showWater) {
          const water = await ctx.builders.structure.tryCreateComponentStatic(struct.cell, 'water');
          if (water) {
            await ctx.builders.structure.representation.addRepresentation(water, { 
              type: 'ball-and-stick', 
              color: 'uniform',
              colorParams: { value: 0x4fc3f7 },
              typeParams: { alpha: 0.3, sizeFactor: 0.1 }
            });
          }
        }
      });
    } catch (err) {
      console.error("Visual Sync Error:", err);
      setErrorDetails("视觉同步失败: " + err.message);
    } finally {
      setIsBusy(false);
    }
  }, [reprStyle, colorTheme, hexColor, showWater, showHetero]);

  // --- 2. 生命周期：初始化引擎 ---
  useEffect(() => {
    const initEngine = async () => {
      try {
        if (!window.molstar) {
          const link = document.createElement('link');
          link.rel = 'stylesheet';
          link.href = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css';
          document.head.appendChild(link);

          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js';
          await new Promise(res => { script.onload = res; document.head.appendChild(script); });
        }

        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false,
          layoutShowControls: false,
          layoutShowRemoteState: false,
          layoutShowSequence: true,
          viewportShowExpand: false,
          viewportShowSelectionMode: false,
        });

        pluginRef.current = viewer;
        await handleFetchPdb(DEFAULT_ID);
        setIsInitializing(false);
      } catch (e) {
        setErrorDetails("引擎初始化失败: " + e.message);
      }
    };
    initEngine();
    return () => pluginRef.current?.dispose();
  }, []);

  // 核心：监听 React 状态，驱动 Mol* 更新
  useEffect(() => {
    if (!isInitializing) syncVisuals();
  }, [reprStyle, colorTheme, hexColor, showWater, showHetero, isInitializing, syncVisuals]);

  // --- 3. 数据加载逻辑：解决“读取失败” ---
  const handleFetchPdb = async (id) => {
    const ctx = pluginRef.current;
    if (!ctx || !id) return;

    setIsBusy(true);
    try {
      await ctx.clear();
      const url = `https://files.rcsb.org/download/${id.toLowerCase()}.pdb`;
      
      // 使用 Molstar 内置的 download 确保流式传输
      const data = await ctx.builders.data.download({ url, isBinary: false });
      const traj = await ctx.builders.structure.parseTrajectory(data, 'pdb');
      await ctx.builders.structure.hierarchy.applyPreset(traj, 'default');
      
      setCurrentId(id.toUpperCase());
      setErrorDetails(null);
      setTimeout(syncVisuals, 100); 
    } catch (e) {
      console.error("Fetch Error:", e);
      setErrorDetails(`无法加载 PDB ${id}: 网络错误或ID不存在`);
    } finally {
      setIsBusy(false);
    }
  };

  const handleLocalFile = async (e) => {
    const file = e.target.files[0];
    if (!file || !pluginRef.current) return;

    setIsBusy(true);
    setErrorDetails(null);
    try {
      await pluginRef.current.clear();
      
      // 关键改进：使用 ArrayBuffer 处理，防止编码问题导致的解析失败
      const buffer = await file.arrayBuffer();
      const binaryData = new Uint8Array(buffer);
      
      const fileName = file.name.toLowerCase();
      const format = (fileName.endsWith('.cif') || fileName.endsWith('.bcif')) ? 'mmcif' : 'pdb';
      const isBinary = fileName.endsWith('.bcif');

      const data = await pluginRef.current.builders.data.rawData({ 
        data: isBinary ? binaryData : new TextDecoder().decode(binaryData), 
        label: file.name 
      });

      const traj = await pluginRef.current.builders.structure.parseTrajectory(data, format);
      await pluginRef.current.builders.structure.hierarchy.applyPreset(traj, 'default');

      setCurrentId(file.name);
      setTimeout(syncVisuals, 200);
    } catch (err) {
      console.error("File Parse Error:", err);
      setErrorDetails("文件解析失败: 请确保文件是标准 PDB 或 CIF 格式");
    } finally {
      setIsBusy(false);
    }
  };

  // --- 下载功能 ---
  const downloadSnapshot = () => {
    if (pluginRef.current) {
      pluginRef.current.canvas3d.requestScreenshot();
    }
  };

  return (
    <div className="flex flex-col h-screen w-full bg-[#0a0a0f] text-slate-200 font-sans overflow-hidden">
      
      {/* 顶部导航：数据输入 */}
      <header className="h-16 flex items-center justify-between px-6 bg-slate-950/80 border-b border-white/5 backdrop-blur-md z-50">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-600 rounded-lg shadow-lg shadow-indigo-500/20">
            <Box className="text-white" size={20} />
          </div>
          <div>
            <h1 className="text-sm font-black tracking-widest text-white">BIOLENS <span className="text-indigo-500">ENGINE</span></h1>
            <p className="text-[9px] text-slate-500 font-mono uppercase tracking-tighter">Molecular Analysis System v4.0</p>
          </div>
        </div>

        <div className="flex items-center gap-3 bg-slate-900/50 p-1.5 rounded-xl border border-white/5">
          <div className="flex items-center px-3 gap-2">
            <Search size={14} className="text-slate-500" />
            <input 
              className="bg-transparent border-none outline-none text-xs w-24 font-mono uppercase placeholder:text-slate-700"
              placeholder="PDB ID..."
              value={searchPdb}
              onChange={e => setSearchPdb(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleFetchPdb(searchPdb)}
            />
          </div>
          <button 
            onClick={() => handleFetchPdb(searchPdb)}
            className="px-4 py-1.5 bg-indigo-600 hover:bg-indigo-500 rounded-lg text-[10px] font-bold transition-all active:scale-95"
          >
            LOAD
          </button>
          
          <div className="w-px h-4 bg-white/10" />

          <label className="flex items-center gap-2 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 rounded-lg text-[10px] font-bold cursor-pointer transition-all border border-white/5">
            <Upload size={14} className="text-indigo-400" /> UPLOAD
            <input type="file" onChange={handleLocalFile} className="hidden" accept=".pdb,.cif,.bcif" />
          </label>
        </div>

        <button onClick={downloadSnapshot} className="p-2 hover:bg-white/5 rounded-full transition-colors text-slate-400">
          <Download size={18} />
        </button>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        
        {/* Mol* 渲染主视口 */}
        <main className="flex-1 relative bg-black">
          {isBusy && (
            <div className="absolute inset-0 z-40 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px]">
              <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin mb-3" />
              <span className="text-[10px] font-mono tracking-[0.2em] text-indigo-400 animate-pulse">SYNCHRONIZING ENGINE...</span>
            </div>
          )}

          {errorDetails && (
            <div className="absolute top-6 left-1/2 -translate-x-1/2 z-50 bg-red-500/10 border border-red-500/50 backdrop-blur-xl text-red-200 px-6 py-3 rounded-2xl flex items-center gap-3 shadow-2xl">
              <AlertCircle size={16} />
              <span className="text-xs font-bold">{errorDetails}</span>
              <button onClick={() => setErrorDetails(null)} className="ml-4 opacity-50 hover:opacity-100">✕</button>
            </div>
          )}
          
          <div ref={containerRef} className="w-full h-full" />
        </main>

        {/* 右侧交互控制台：核心功能区 */}
        <aside className="w-72 bg-slate-950 border-l border-white/5 p-6 flex flex-col gap-8 z-40 shadow-[-20px_0_40px_rgba(0,0,0,0.8)] overflow-y-auto custom-scrollbar">
          
          {/* 状态指示 */}
          <div className="p-4 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl">
            <span className="text-[9px] font-bold text-indigo-500 uppercase tracking-widest">Active Structure</span>
            <h2 className="text-sm font-mono text-indigo-100 mt-1 truncate">{currentId}</h2>
          </div>

          {/* 渲染样式交互 */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Layers size={14} className="text-slate-500" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Geometry</h3>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                {id: 'cartoon', label: 'Cartoon'},
                {id: 'molecular-surface', label: 'Surface'},
                {id: 'ball-and-stick', label: 'B & S'},
                {id: 'spacefill', label: 'Sphere'},
              ].map(item => (
                <button 
                  key={item.id}
                  onClick={() => setReprStyle(item.id)}
                  className={`py-3 rounded-xl text-[10px] font-bold transition-all border
                  ${reprStyle === item.id 
                    ? 'bg-indigo-600 border-indigo-400 text-white shadow-lg shadow-indigo-600/30 active:scale-95' 
                    : 'bg-slate-900 border-white/5 text-slate-500 hover:border-white/10 hover:bg-slate-800'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </section>

          {/* 着色系统交互 */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Palette size={14} className="text-slate-500" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Coloring</h3>
            </div>
            <div className="space-y-3">
              <select 
                className="w-full bg-slate-900 border border-white/10 rounded-xl p-3 text-xs text-slate-300 outline-none focus:ring-1 focus:ring-indigo-500"
                value={colorTheme}
                onChange={e => setColorTheme(e.target.value)}
              >
                <option value="chain-id">By Chain ID</option>
                <option value="element-symbol">By Element (CPK)</option>
                <option value="residue-name">By Residue</option>
                <option value="hydrophobicity">By Hydrophobicity</option>
                <option value="uniform">Custom Uniform</option>
              </select>

              {colorTheme === 'uniform' && (
                <div className="flex items-center justify-between p-3 bg-slate-900 rounded-xl border border-white/5">
                  <span className="text-[10px] font-bold text-slate-500 uppercase">Tint Color</span>
                  <input 
                    type="color" 
                    value={hexColor} 
                    onChange={e => setHexColor(e.target.value)}
                    className="w-8 h-8 bg-transparent border-none cursor-pointer"
                  />
                </div>
              )}
            </div>
          </section>

          {/* 子系统开关交互 */}
          <section>
            <div className="flex items-center gap-2 mb-4">
              <Activity size={14} className="text-slate-500" />
              <h3 className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-500">Sub-systems</h3>
            </div>
            <div className="space-y-2">
              <ToggleButton 
                icon={<Droplet size={12}/>} 
                label="Solvent (H2O)" 
                active={showWater} 
                onClick={() => setShowWater(!showWater)} 
              />
              <ToggleButton 
                icon={<Eye size={12}/>} 
                label="Hetero Atoms" 
                active={showHetero} 
                onClick={() => setShowHetero(!showHetero)} 
              />
            </div>
          </section>

          <div className="mt-auto">
             <button 
              onClick={() => pluginRef.current?.managers.camera.reset()}
              className="w-full py-4 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-2xl text-[10px] font-black tracking-widest transition-all border border-white/5 flex items-center justify-center gap-2"
            >
              <RefreshCw size={14} /> RESET VIEWPORT
            </button>
          </div>

        </aside>
      </div>
    </div>
  );
};

// 辅助组件：交互开关
const ToggleButton = ({ label, active, onClick, icon }) => (
  <button 
    onClick={onClick}
    className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all ${
      active ? 'bg-indigo-500/10 border-indigo-500/50 text-indigo-400' : 'bg-slate-900 border-white/5 text-slate-600 opacity-60'
    }`}
  >
    <div className="flex items-center gap-3">
      {icon}
      <span className="text-[10px] font-bold uppercase">{label}</span>
    </div>
    <div className={`w-1.5 h-1.5 rounded-full ${active ? 'bg-indigo-400 shadow-[0_0_8px_rgba(129,140,248,0.8)]' : 'bg-slate-700'}`} />
  </button>
);

export default BioLensFinal;
