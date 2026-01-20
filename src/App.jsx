'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Camera, Upload, Download, Search, Zap, Droplet, Box, 
  AlertCircle, RefreshCw, Eye, MessageSquare, Send,
  Cpu, Layers, Settings, Maximize, Sparkles, Wand2, Palette,
  MousePointer2, CircleDashed, Link2, Target, Microscope, ScanSearch
} from 'lucide-react';

/**
 * BioLens Agent Pro - V4.0 (High Contrast & Logic Fix)
 * * Update Log:
 * 1. [Visual] Changed Chain Overlay to 'ball-and-stick' to fix "no visual response" issue (z-fighting).
 * 2. [Logic] Rewrote Command Parser: Logic is now "Feature Detection" based, not strict Regex groups.
 * 3. [Fix] Global H-Bond logic simplified to ensure "全局氢键" always triggers.
 * 4. [UX] Added clear visual cues (Toast + Chat response) for every action.
 */

// -----------------------------------------------------------------------------
// 1. Static Configuration
// -----------------------------------------------------------------------------
const loadMolstarResources = () => {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') { resolve(); return; }
    if (window.molstar) { resolve(); return; }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.css';
    document.head.appendChild(link);

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/molstar@latest/build/viewer/molstar.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load Mol* script"));
    document.head.appendChild(script);
  });
};

const STYLES = {
  cartoon: { label: 'Cartoon', type: 'cartoon', param: { alpha: 1 } },
  surface: { label: 'Surface', type: 'molecular-surface', param: { alpha: 0.9, quality: 'auto' } },
  bns: { label: 'Ball & Stick', type: 'ball-and-stick', param: { sizeFactor: 0.2 } },
  spacefill: { label: 'Spacefill', type: 'spacefill', param: { } },
};

const JOURNAL_PRESETS = {
  default: { label: 'Standard', bgColor: 0xf8f9fa, style: 'cartoon', color: 'chain', lighting: 'flat' },
  nature: { label: 'Nature (Paper)', bgColor: 0xffffff, style: 'cartoon', color: 'chain', lighting: 'occlusion', param: { alpha: 1.0 } },
  dark: { label: 'Dark (Pymol)', bgColor: 0x000000, style: 'cartoon', color: 'element', lighting: 'plastic' },
  hologram: { label: 'Hologram (Cyber)', bgColor: 0x000000, style: 'bns', color: 'uniform', customColor: 0x00ffcc, lighting: 'flat' }
};

const COLORS = {
  chain: { label: 'By Chain', type: 'chain-id' },
  element: { label: 'By Element', type: 'element-symbol' },
  hydro: { label: 'Hydrophobicity', type: 'hydrophobicity' },
  rainbow: { label: 'Rainbow', type: 'sequence-id' }, 
  uniform: { label: 'Uniform', type: 'uniform' }
};

const BioLensApp = () => {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const chatEndRef = useRef(null);

  // --- State ---
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [pdbId, setPdbId] = useState("4HHB");
  const [fileName, setFileName] = useState("4HHB");
  const [toast, setToast] = useState(null);
  
  // Visual
  const [activePreset, setActivePreset] = useState('default');
  const [activeStyle, setActiveStyle] = useState('cartoon');
  const [activeColorMode, setActiveColorMode] = useState('chain');
  const [customColor, setCustomColor] = useState('#4f46e5');
  const [showWater, setShowWater] = useState(false);
  const [showLigands, setShowLigands] = useState(true);

  // Interaction
  const [clickMode, setClickMode] = useState('pick'); 
  const [agentOverlays, setAgentOverlays] = useState([]); 
  const [messages, setMessages] = useState([{ role: 'system', content: 'Agent Ready. 试着输入: "A链变蓝", "氨基酸A链100变红", "显示全局氢键"' }]);
  const [inputMsg, setInputMsg] = useState("");

  // Helpers
  const showToast = (msg) => {
      setToast(msg);
      setTimeout(() => setToast(null), 3000);
  };

  // ---------------------------------------------------------------------------
  // Init
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const init = async () => {
      try {
        await loadMolstarResources();
        if (!window.molstar) return;
        const viewer = await window.molstar.Viewer.create(containerRef.current, {
          layoutIsExpanded: false, layoutShowControls: false, layoutShowRemoteState: false,
          layoutShowSequence: true, viewportShowExpand: false, viewportShowSelectionMode: true,
          viewportShowAnimation: true,
        });
        viewerRef.current = viewer;
        await handleFetchPdb('4HHB'); 
        setLoading(false);
      } catch (e) {
        console.error(e);
        setError("Init Error: " + e.message);
        setLoading(false);
      }
    };
    init();
    return () => viewerRef.current?.dispose();
  }, []);

  const getPlugin = () => viewerRef.current?.plugin;

  // ---------------------------------------------------------------------------
  // Click Listener
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const plugin = getPlugin();
    if (!plugin) return;

    const clickSub = plugin.behaviors.interaction.click.subscribe(async (e) => {
        if (clickMode === 'pick') return; 

        const currentLoci = e.current.loci;
        const MS = window.molstar?.MolScriptBuilder;
        
        if (MS && currentLoci.kind === 'element-loci' && currentLoci.elements.length > 0) {
            try {
               const structure = currentLoci.structure;
               const unit = currentLoci.elements[0].unit;
               const index = currentLoci.elements[0].indices[0];
               
               const SP = window.molstar.StructureProperties;
               const SE = window.molstar.StructureElement;
               if (SP && SE) {
                   const loc = SE.Location.create(structure, unit, index);
                   const seqId = SP.residue.auth_seq_id(loc);
                   const chainId = SP.chain.auth_asym_id(loc);
                   const resName = SP.residue.label_comp_id(loc);
                   
                   let newOverlay = null;
                   let feedbackMsg = "";

                   if (clickMode === 'zone5') {
                       newOverlay = { type: 'zone', target: `${seqId}`, targetChain: chainId, radius: 5, color: '#ff0055', rawSeqId: seqId };
                       feedbackMsg = `Zone 5Å: 残基 ${resName} ${seqId} (链${chainId})`;
                   } else if (clickMode === 'hbond') {
                        newOverlay = { type: 'residue', target: `${seqId}`, targetChain: chainId, interaction: true, color: '#ffff00', style: 'ball-and-stick' };
                       feedbackMsg = `H-Bonds: 残基 ${resName} ${seqId} (链${chainId})`;
                   }

                   if (newOverlay) {
                       setAgentOverlays(prev => [...prev, newOverlay]);
                       showToast(feedbackMsg);
                       setMessages(prev => [...prev, { role: 'system', content: `[点击] ${feedbackMsg}` }]);
                   }
               }
            } catch (err) { console.warn("Click error:", err); }
        }
    });

    return () => clickSub.unsubscribe();
  }, [clickMode]);

  // ---------------------------------------------------------------------------
  // Core: Visual Sync
  // ---------------------------------------------------------------------------
  const syncVisuals = useCallback(async () => {
    const plugin = getPlugin();
    if (!plugin) return;
    if (!plugin.managers.structure.hierarchy.current.structures.length) return;

    try {
        await plugin.dataTransaction(async () => {
            const hierarchy = plugin.managers.structure.hierarchy.current;
            const structure = hierarchy.structures[0];
            const state = plugin.state.data;
            if (!structure || !structure.cell || !state.cells.has(structure.cell.transform.ref)) return;

            // 1. Environment
            const canvas = plugin.canvas3d;
            const preset = JOURNAL_PRESETS[activePreset]; 
            if (canvas && preset) {
                const rendererProps = { backgroundColor: preset.bgColor };
                const postProps = { occlusion: { name: 'off', params: {} }, outline: { name: 'off', params: {} } };
                if (preset.lighting === 'occlusion') postProps.occlusion = { name: 'on', params: { samples: 32, radius: 5, bias: 0.8 } };
                else if (preset.lighting === 'plastic') rendererProps.style = { name: 'matte' };
                canvas.setProps({ renderer: rendererProps, postProcessing: postProps });
            }

            // 2. Clean Base (Safe Delete)
            const currentComponents = structure.components;
            const componentsToDelete = [];
            for (const c of currentComponents) {
                if (c.cell && state.cells.has(c.cell.transform.ref)) componentsToDelete.push(c);
            }
            if (componentsToDelete.length > 0) await plugin.managers.structure.hierarchy.remove(componentsToDelete);

            // 3. Render Base
            if (!state.cells.has(structure.cell.transform.ref)) return;
            const polymerComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'polymer');
            if (polymerComp && state.cells.has(polymerComp.ref)) {
                let colorProps = { name: COLORS[activeColorMode]?.type || 'chain-id' };
                if (activeColorMode === 'uniform') colorProps = { name: 'uniform', params: { value: parseInt(customColor.replace('#', ''), 16) } };
                if (activePreset === 'hologram') colorProps = { name: 'uniform', params: { value: JOURNAL_PRESETS.hologram.customColor } };
                
                const styleConfig = STYLES[activeStyle] || STYLES['cartoon'];
                await plugin.builders.structure.representation.addRepresentation(polymerComp, {
                    type: styleConfig.type, typeParams: styleConfig.param, color: colorProps.name, colorParams: colorProps.params,
                });
            }

            // 4. Standard Details
            if (showLigands) {
                const ligandComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'ligand');
                if (ligandComp && state.cells.has(ligandComp.ref)) await plugin.builders.structure.representation.addRepresentation(ligandComp, { type: 'ball-and-stick', color: 'element-symbol' });
            }
            if (showWater) {
                const waterComp = await plugin.builders.structure.tryCreateComponentStatic(structure.cell, 'water');
                if (waterComp && state.cells.has(waterComp.ref)) await plugin.builders.structure.representation.addRepresentation(waterComp, { type: 'ball-and-stick', color: 'uniform', colorParams: { value: 0x88ccff }, typeParams: { alpha: 0.4 } });
            }

            // 5. AGENT OVERLAYS (The Highlight System)
            const MS = window.molstar?.MolScriptBuilder;
            if (!MS) return;

            for (const overlay of agentOverlays) {
                let expression = null;
                const chainTest = overlay.targetChain ? MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.targetChain]) : null;

                if (overlay.type === 'global-hbond') {
                     const allPolymers = MS.struct.generator.atomGroups({ 'entity-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'polymer']) });
                     const selComp = await plugin.builders.structure.tryCreateComponentFromExpression(structure.cell, allPolymers, 'custom-selection', { label: 'Global H-Bonds' });
                     if (selComp && state.cells.has(selComp.ref)) {
                         await plugin.builders.structure.representation.addRepresentation(selComp, {
                             type: 'interactions', typeParams: { includeCovalent: false, interactionTypes: ['hydrogen-bond', 'weak-hydrogen-bond', 'ionic', 'pi-pi'], sizeFactor: 0.2 }
                         });
                     }
                     continue;
                }

                if (overlay.type === 'chain') expression = MS.struct.generator.atomGroups({ 'chain-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_asym_id(), overlay.target]) });
                else if (overlay.type === 'residue') {
                    const [start, end] = overlay.target.split('-').map(Number);
                    const endRes = end || start;
                    const resTest = MS.core.logic.and([ MS.core.rel.gr([MS.struct.atomProperty.macromolecular.auth_seq_id(), start - 1]), MS.core.rel.lt([MS.struct.atomProperty.macromolecular.auth_seq_id(), endRes + 1]) ]);
                    // If targetChain is null, we don't constrain by chain (useful for "Residue 100 on ALL chains")
                    expression = MS.struct.generator.atomGroups({ 'residue-test': resTest, 'chain-test': chainTest || true });
                }
                else if (overlay.type === 'zone') {
                    const centerExp = MS.struct.generator.atomGroups({ 'residue-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.auth_seq_id(), overlay.rawSeqId]), 'chain-test': chainTest || true });
                    expression = MS.struct.modifier.includeSurroundings({ 0: centerExp, radius: overlay.radius || 5, 'as-whole-residues': true });
                }
                else if (overlay.type === 'ligand-surround') {
                     const ligExp = MS.struct.generator.atomGroups({ 'entity-test': MS.core.rel.eq([MS.struct.atomProperty.macromolecular.entityType(), 'non-polymer']) });
                     expression = MS.struct.modifier.includeSurroundings({ 0: ligExp, radius: 5, 'as-whole-residues': true });
                }

                if (expression) {
                    const selComp = await plugin.builders.structure.tryCreateComponentFromExpression(structure.cell, expression, 'custom-selection', { label: 'Overlay' });
                    if (selComp && state.cells.has(selComp.ref)) {
                        if (overlay.interaction) {
                            await plugin.builders.structure.representation.addRepresentation(selComp, { type: 'interactions', typeParams: { includeCovalent: false } });
                            await plugin.builders.structure.representation.addRepresentation(selComp, { type: 'ball-and-stick', color: 'element-symbol', typeParams: { sizeFactor: 0.15 } });
                        } else {
                            const colorVal = parseInt(overlay.color.replace('#', ''), 16);
                            // VISUAL FIX: Use 'ball-and-stick' for chains to ensure they pop over cartoon
                            const ovStyle = overlay.type === 'chain' ? 'ball-and-stick' : (overlay.style || 'ball-and-stick');
                            
                            await plugin.builders.structure.representation.addRepresentation(selComp, {
                                type: ovStyle, color: 'uniform', colorParams: { value: colorVal }, typeParams: { sizeFactor: 0.25 } 
                            });
                        }
                    }
                }
            }
        });
    } catch (err) { console.error("Render Error:", err); }
  }, [activePreset, activeStyle, activeColorMode, customColor, showWater, showLigands, agentOverlays]);

  useEffect(() => { if (!loading) syncVisuals(); }, [syncVisuals, loading]);

  // ---------------------------------------------------------------------------
  // Agent & IO
  // ---------------------------------------------------------------------------
  const handleFetchPdb = async (id) => {
      const plugin = getPlugin(); if (!plugin || !id) return;
      setLoading(true); setAgentOverlays([]); 
      try {
          await plugin.clear();
          const data = await plugin.builders.data.download({ url: `https://files.rcsb.org/download/${id.toUpperCase()}.pdb`, isBinary: false });
          const traj = await plugin.builders.structure.parseTrajectory(data, 'pdb');
          const model = await plugin.builders.structure.createModel(traj);
          await plugin.builders.structure.createStructure(model);
          setFileName(id.toUpperCase()); setLoading(false);
          showToast(`已加载结构: ${id}`);
      } catch (err) { setError("Fetch failed"); setLoading(false); }
  };

  const handleFileUpload = (e) => {
      const file = e.target.files[0]; const plugin = getPlugin(); if (!file || !plugin) return;
      setLoading(true); setAgentOverlays([]);
      const reader = new FileReader();
      reader.onload = async (evt) => {
          try {
              await plugin.clear();
              const isBinary = file.name.endsWith('.bcif');
              const data = await plugin.builders.data.rawData({ data: isBinary ? new Uint8Array(evt.target.result) : evt.target.result, label: file.name });
              const format = file.name.includes('cif') ? (isBinary ? 'bcif' : 'mmcif') : 'pdb';
              const traj = await plugin.builders.structure.parseTrajectory(data, format);
              const model = await plugin.builders.structure.createModel(traj);
              await plugin.builders.structure.createStructure(model);
              setFileName(file.name); setLoading(false);
              showToast(`已加载文件: ${file.name}`);
          } catch (e) { setError("Parse failed"); setLoading(false); }
      };
      if (file.name.endsWith('.bcif')) reader.readAsArrayBuffer(file); else reader.readAsText(file);
  };

  // ---------------------------------------------------------------------------
  // Agent Logic (Rewritten for V4.0)
  // ---------------------------------------------------------------------------
  const processAgentCommand = async (cmd) => {
      const lowerCmd = cmd.toLowerCase();
      
      // --- 1. Detect Intent Features ---
      
      // Color
      let colorCode = '#ff0000'; // Default
      let hasColor = false;
      if (lowerCmd.match(/red|红/)) { colorCode = '#ff0000'; hasColor = true; }
      else if (lowerCmd.match(/blue|蓝/)) { colorCode = '#0000ff'; hasColor = true; }
      else if (lowerCmd.match(/green|绿/)) { colorCode = '#00ff00'; hasColor = true; }
      else if (lowerCmd.match(/yellow|黄/)) { colorCode = '#ffff00'; hasColor = true; }
      else if (lowerCmd.match(/purple|紫/)) { colorCode = '#800080'; hasColor = true; }
      else if (lowerCmd.match(/cyan|青/)) { colorCode = '#00ffff'; hasColor = true; }

      // Chain ID (e.g., "A")
      // Match "Chain A", "A链", or just "A" if context is right? No, keep it safe.
      // "A链" -> match[1] = "A"
      const chainMatch = cmd.match(/(?:chain|链)\s*([a-zA-Z0-9])/i) || cmd.match(/([a-zA-Z0-9])\s*(?:chain|链)/i);
      const chainId = chainMatch ? chainMatch[1].toUpperCase() : null;

      // Residue ID (e.g., "100")
      // We look for ANY number.
      const numMatch = lowerCmd.match(/(\d+)/);
      const resId = numMatch ? numMatch[1] : null;

      // Keywords
      const isResidueKw = lowerCmd.match(/(residue|res|残基|氨基酸|位点)/);
      const isHbond = lowerCmd.match(/bond|interaction|h-bond|氢键/);
      const isGlobal = lowerCmd.match(/(global|all|全局|整体)/);
      const isPocket = lowerCmd.match(/(pocket|binding|结合|口袋)/);
      const isFocus = lowerCmd.match(/(focus|show|view|看|聚焦)/);
      const isLigand = lowerCmd.match(/(ligand|drug|配体|药)/);

      // --- 2. Execute based on Specificity (Most Specific First) ---

      // A. Special Modes
      if (isPocket && isLigand) {
           setAgentOverlays(prev => [...prev, { type: 'ligand-surround', color: '#ff9900' }]);
           return "已显示配体结合口袋";
      }
      if (isGlobal && isHbond) {
           setAgentOverlays(prev => [...prev, { type: 'global-hbond' }]);
           return "已显示全局氢键网络";
      }
      if (isFocus && isLigand) {
           setShowLigands(true);
           // Trigger focus in main thread
           const plugin = getPlugin();
           const lig = plugin?.managers.structure.hierarchy.current.structures[0]?.components.find(c => c.key === 'ligand');
           if(lig) plugin.managers.camera.focusLoci(plugin.managers.structure.selection.getLoci(lig.obj.data));
           return "已聚焦配体";
      }

      // B. Residue Target (Highest Priority for numbers)
      // Logic: If we found a number, AND (we found 'residue' keyword OR we found a chain ID), assume it's a residue.
      // e.g., "A链100" -> Chain A, Residue 100.
      // e.g., "100号" -> Residue 100 (wildcard chain).
      if (resId && (isResidueKw || chainId)) {
          setAgentOverlays(prev => [...prev, { 
              type: 'residue', 
              target: `${resId}-${resId}`, // Single residue range
              targetChain: chainId, // Specific chain or null
              interaction: isHbond, 
              color: isHbond ? '#ffff00' : colorCode, 
              style: 'ball-and-stick' 
          }]);
          const chainText = chainId ? `(链${chainId})` : '';
          return isHbond ? `显示残基 ${resId}${chainText} 氢键` : `标记残基 ${resId}${chainText} 为 ${colorCode}`;
      }

      // C. Chain Target (Medium Priority)
      // Only if no residue number was processed.
      if (chainId) {
          setAgentOverlays(prev => [...prev, { type: 'chain', target: chainId, color: colorCode }]);
          return `已标记 ${chainId} 链 (${colorCode})`;
      }

      // D. Global Color (Low Priority)
      // Fallback: If only color is mentioned or "global"
      if (isGlobal || hasColor) {
          setCustomColor(colorCode); 
          setActiveColorMode('uniform'); 
          setActivePreset('custom');
          return "已应用全局颜色";
      }

      // E. Other
      if (lowerCmd.includes('nature')) { setActivePreset('nature'); return "Nature 风格"; }
      if (lowerCmd.includes('dark')) { setActivePreset('dark'); return "Dark 风格"; }
      if (lowerCmd.includes('clear') || lowerCmd.includes('清除')) { setAgentOverlays([]); return "已清除图层"; }

      return "指令不明确 (试着说: 'A链变蓝', '100号残基氢键')";
  };

  const handleChatSubmit = async (e) => {
      e.preventDefault(); if (!inputMsg.trim()) return;
      const userText = inputMsg; setMessages(prev => [...prev, { role: 'user', content: userText }]);
      setInputMsg("");
      setTimeout(async () => {
          const reply = await processAgentCommand(userText);
          setMessages(prev => [...prev, { role: 'system', content: reply }]);
          showToast(reply);
      }, 300);
  };

  const applyPreset = (key) => {
      const p = JOURNAL_PRESETS[key]; setActivePreset(key); setActiveStyle(p.style); setActiveColorMode(p.color);
      if (p.customColor) setCustomColor('#' + p.customColor.toString(16).padStart(6, '0'));
  };

  const isLigandPocketActive = agentOverlays.some(o => o.type === 'ligand-surround');
  const isGlobalHbondActive = agentOverlays.some(o => o.type === 'global-hbond');

  return (
    <div className="flex flex-col h-screen w-full bg-slate-50 text-slate-800 font-sans overflow-hidden">
      {toast && (
          <div className="absolute bottom-20 left-1/2 -translate-x-1/2 z-50 bg-slate-800/90 text-white px-4 py-2 rounded-full shadow-xl flex items-center gap-2 animate-fade-in-up transition-all pointer-events-none">
              <Sparkles size={14} className="text-yellow-400"/>
              <span className="text-xs font-medium">{toast}</span>
          </div>
      )}

      <header className="h-14 bg-white border-b flex items-center justify-between px-4 shadow-sm z-20">
        <div className="flex items-center gap-2">
           <div className="bg-indigo-600 p-1.5 rounded text-white"><Cpu size={18}/></div>
           <h1 className="font-bold text-lg tracking-tight">BioLens <span className="text-indigo-600">Pro</span></h1>
        </div>
        <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-100 rounded-md overflow-hidden border border-transparent focus-within:border-indigo-500">
                <div className="pl-2 text-slate-400"><Search size={14}/></div>
                <input className="bg-transparent border-none outline-none text-sm w-24 px-2 py-1.5 uppercase" placeholder="PDB ID"
                    value={pdbId} onChange={e => setPdbId(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleFetchPdb(pdbId)} />
            </div>
            <button onClick={() => handleFetchPdb(pdbId)} className="btn-secondary">Load</button>
            <label className="btn-primary cursor-pointer flex items-center gap-2"><Upload size={14}/> Open <input type="file" className="hidden" onChange={handleFileUpload} /></label>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden relative">
        <main className="flex-1 relative bg-slate-200">
           {loading && <div className="absolute inset-0 z-50 flex items-center justify-center bg-white/80"><div className="animate-spin text-indigo-600"><RefreshCw/></div></div>}
           {error && <div className="absolute top-10 left-1/2 -translate-x-1/2 z-50 bg-red-100 text-red-700 px-4 py-2 rounded flex gap-2"><AlertCircle size={18}/>{error}<button onClick={()=>setError(null)}>x</button></div>}
           <div ref={containerRef} className="absolute inset-0 w-full h-full" />
           <div className="absolute top-4 left-4 z-10 flex flex-col gap-2">
              <div className="bg-white/90 backdrop-blur px-3 py-1.5 rounded shadow text-xs font-bold text-slate-600 border">ID: {fileName}</div>
              {agentOverlays.length > 0 && <button onClick={() => setAgentOverlays([])} className="bg-red-500/90 text-white px-3 py-1.5 rounded shadow text-xs font-bold hover:bg-red-600 flex items-center gap-1 transition-all"><Wand2 size={12}/> Clear Layers ({agentOverlays.length})</button>}
           </div>
        </main>

        <aside className="w-80 bg-white border-l flex flex-col z-20 shadow-xl">
            <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
                
                <section>
                    <SectionHeader icon={<Target size={14} className="text-pink-500"/>} title="Smart Targets (靶点)" />
                    <div className="grid grid-cols-1 gap-2 mt-2">
                        <button onClick={() => processAgentCommand("focus ligand")} className="flex items-center gap-2 p-2.5 rounded-lg border bg-white hover:bg-pink-50 transition-colors text-left group active:scale-95">
                            <div className="p-1.5 bg-pink-100 text-pink-600 rounded-md group-hover:scale-110 transition-transform"><ScanSearch size={16}/></div>
                            <div className="flex flex-col">
                                <span className="text-xs font-bold text-slate-700">Focus Ligand</span>
                                <span className="text-[10px] text-slate-400">聚焦配体/药物分子</span>
                            </div>
                        </button>
                        <div className="grid grid-cols-2 gap-2">
                            <button onClick={() => processAgentCommand("ligand pocket")} className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 ${isLigandPocketActive ? 'bg-amber-100 border-amber-300 text-amber-800 shadow-inner scale-95' : 'bg-white hover:bg-amber-50 text-slate-600'}`}>
                                <Microscope size={16} className={isLigandPocketActive ? "text-amber-700" : "text-amber-500"}/>
                                <span className="text-[10px] font-medium">Binding Pocket</span>
                                {isLigandPocketActive && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse"/>}
                            </button>
                            <button onClick={() => processAgentCommand("global h-bond")} className={`flex flex-col items-center justify-center p-2 rounded-lg border transition-all gap-1 ${isGlobalHbondActive ? 'bg-indigo-100 border-indigo-300 text-indigo-800 shadow-inner scale-95' : 'bg-white hover:bg-indigo-50 text-slate-600'}`}>
                                <Link2 size={16} className={isGlobalHbondActive ? "text-indigo-700" : "text-indigo-500"}/>
                                <span className="text-[10px] font-medium">Global H-Bonds</span>
                                {isGlobalHbondActive && <div className="absolute top-1 right-1 w-2 h-2 bg-green-500 rounded-full animate-pulse"/>}
                            </button>
                        </div>
                    </div>
                </section>

                <section>
                    <SectionHeader icon={<MousePointer2 size={14} className="text-indigo-500"/>} title="Click Action (点击交互)" />
                    <div className="grid grid-cols-3 gap-2 mt-2">
                         <button onClick={() => setClickMode('pick')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'pick' ? 'bg-indigo-600 text-white shadow-md transform scale-105' : 'bg-white hover:bg-slate-50'}`}>
                             <MousePointer2 size={14}/> Focus
                         </button>
                         <button onClick={() => setClickMode('zone5')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'zone5' ? 'bg-red-600 text-white shadow-md transform scale-105' : 'bg-white hover:bg-red-50'}`}>
                             <CircleDashed size={14}/> Zone 5Å
                         </button>
                         <button onClick={() => setClickMode('hbond')} className={`text-[10px] p-2 rounded border flex flex-col items-center gap-1 transition-all ${clickMode === 'hbond' ? 'bg-amber-500 text-white shadow-md transform scale-105' : 'bg-white hover:bg-amber-50'}`}>
                             <Link2 size={14}/> H-Bond
                         </button>
                    </div>
                    <div className="mt-2 text-[10px] text-center text-slate-400 bg-slate-50 py-1 rounded">
                        {clickMode === 'pick' && "模式：点击原子以聚焦视角"}
                        {clickMode === 'zone5' && "模式：点击原子显示周围 5Å 残基"}
                        {clickMode === 'hbond' && "模式：点击原子分析氢键相互作用"}
                    </div>
                </section>

                <section>
                    <SectionHeader icon={<Sparkles size={14} className="text-amber-500"/>} title="Journal Styles" />
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        {Object.entries(JOURNAL_PRESETS).map(([key, cfg]) => (
                            <button key={key} onClick={() => applyPreset(key)} 
                                className={`text-xs py-2.5 px-3 rounded-xl border font-bold text-left flex items-center justify-between group ${activePreset === key ? 'bg-slate-800 text-white border-slate-800' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-300'}`}>
                                {cfg.label}
                                {activePreset === key && <div className="w-1.5 h-1.5 rounded-full bg-green-400 shadow-[0_0_5px_rgba(74,222,128,0.8)]"/>}
                            </button>
                        ))}
                    </div>
                </section>

                <section>
                    <SectionHeader icon={<Layers size={14}/>} title="Manual Control" />
                    <div className="grid grid-cols-2 gap-2 mt-2">
                        {Object.entries(STYLES).map(([key, cfg]) => (
                            <button key={key} onClick={() => { setActiveStyle(key); setActivePreset('custom'); }} 
                                className={`text-xs py-1.5 px-2 rounded border transition-colors ${activeStyle === key ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-slate-50'}`}>
                                {cfg.label}
                            </button>
                        ))}
                    </div>
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {Object.entries(COLORS).map(([key, cfg]) => (
                            <button key={key} onClick={() => { setActiveColorMode(key); setActivePreset('custom'); }} 
                                className={`text-[10px] px-2 py-1 rounded border ${activeColorMode === key ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white'}`}>
                                {cfg.label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 flex items-center justify-between bg-slate-50 p-2 rounded-lg border border-slate-100">
                        <div className="flex items-center gap-2"> <Palette size={14} className="text-slate-400"/> <span className="text-xs text-slate-600 font-medium">Tint Color</span> </div>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] font-mono text-slate-400">{customColor}</span>
                            <input type="color" value={customColor} onChange={(e) => { setCustomColor(e.target.value); setActiveColorMode('uniform'); setActivePreset('custom'); }} className="w-6 h-6 rounded cursor-pointer border-none bg-transparent p-0" />
                        </div>
                    </div>
                </section>
            </div>

            <div className="h-64 border-t bg-slate-50 flex flex-col">
                <div className="px-3 py-2 border-b bg-white flex items-center gap-2 text-indigo-600 shadow-sm"><MessageSquare size={14} /><span className="text-xs font-bold uppercase tracking-wider">Bio-Agent Command</span></div>
                <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50/50">
                    {messages.map((msg, idx) => (
                        <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                            <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs leading-relaxed shadow-sm ${msg.role === 'user' ? 'bg-indigo-600 text-white rounded-tr-none' : 'bg-white border border-slate-200 text-slate-700 rounded-tl-none'}`}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    <div ref={chatEndRef} />
                </div>
                <form onSubmit={handleChatSubmit} className="p-2 bg-white border-t flex gap-2">
                    <input className="flex-1 bg-slate-100 border-none rounded-lg px-3 py-2 text-xs focus:ring-1 focus:ring-indigo-500 outline-none" placeholder="指令..." value={inputMsg} onChange={e => setInputMsg(e.target.value)} />
                    <button type="submit" className="p-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"><Send size={14} /></button>
                </form>
            </div>
        </aside>
      </div>
      <style>{`
        .btn-primary { @apply px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded transition-colors shadow-sm; }
        .btn-secondary { @apply px-3 py-1.5 bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-bold rounded transition-colors; }
        .custom-scrollbar::-webkit-scrollbar { width: 4px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 2px; }
        @keyframes fade-in-up { 0% { opacity: 0; transform: translate(-50%, 10px); } 100% { opacity: 1; transform: translate(-50%, 0); } }
        .animate-fade-in-up { animation: fade-in-up 0.3s ease-out forwards; }
      `}</style>
    </div>
  );
};

const SectionHeader = ({ icon, title }) => (
    <div className="flex items-center gap-2 mb-2 text-slate-400">
        {icon} <span className="text-[10px] font-bold uppercase tracking-widest">{title}</span>
    </div>
);

const ToggleRow = ({ label, active, onClick }) => (
    <div onClick={onClick} className="flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-slate-100 border border-transparent transition-all">
        <span className="text-xs font-medium text-slate-600">{label}</span>
        <div className={`w-8 h-4 rounded-full relative transition-colors ${active ? 'bg-green-500' : 'bg-slate-300'}`}>
            <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-transform ${active ? 'left-4.5 translate-x-1' : 'left-0.5'}`} />
        </div>
    </div>
);

export default BioLensApp;
