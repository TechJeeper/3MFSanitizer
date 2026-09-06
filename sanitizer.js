/**
 * Universal 3MF sanitizer.
 * Flattens Bambu/Orca production-extension projects into core 3MF so Cura,
 * PrusaSlicer, and Anycubic can import them, while keeping painted colors,
 * filament colors, and designer process settings (walls, line width, infill, …).
 */
(function (root, factory) {
    if (typeof module === "object" && module.exports) {
        module.exports = factory();
    } else {
        root.ThreeMFSanitizer = factory();
    }
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
    "use strict";

    const CORE_NS = "http://schemas.microsoft.com/3dmanufacturing/core/2015/02";
    const MODEL_REL = "http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel";
    const THUMB_REL = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail";

    const BAMBU_TO_SLIC3R = {
        layer_height: "layer_height",
        initial_layer_print_height: "first_layer_height",
        wall_loops: "perimeters",
        top_shell_layers: "top_solid_layers",
        bottom_shell_layers: "bottom_solid_layers",
        top_shell_thickness: "top_solid_min_thickness",
        bottom_shell_thickness: "bottom_solid_min_thickness",
        sparse_infill_density: "fill_density",
        sparse_infill_pattern: "fill_pattern",
        line_width: "extrusion_width",
        outer_wall_line_width: "external_perimeter_extrusion_width",
        inner_wall_line_width: "perimeter_extrusion_width",
        initial_layer_line_width: "first_layer_extrusion_width",
        sparse_infill_line_width: "infill_extrusion_width",
        internal_solid_infill_line_width: "solid_infill_extrusion_width",
        top_surface_line_width: "top_infill_extrusion_width",
        support_line_width: "support_material_extrusion_width",
        enable_support: "support_material",
        support_threshold_angle: "support_material_threshold",
        support_on_build_plate_only: "support_material_buildplate_only",
        support_object_xy_distance: "support_material_xy_spacing",
        support_top_z_distance: "support_material_contact_distance",
        raft_layers: "raft_layers",
        brim_width: "brim_width",
        brim_type: "brim_type",
        skirt_loops: "skirts",
        skirt_distance: "skirt_distance",
        skirt_height: "skirt_height",
        detect_thin_wall: "thin_walls",
        wall_generator: "perimeter_generator",
        infill_wall_overlap: "infill_overlap",
        infill_direction: "fill_angle",
        ironing_type: "ironing",
        ironing_flow: "ironing_flowrate",
        ironing_spacing: "ironing_spacing",
        filament_colour: "filament_colour",
        filament_type: "filament_type",
        filament_diameter: "filament_diameter",
        filament_density: "filament_density",
        nozzle_temperature: "temperature",
        nozzle_temperature_initial_layer: "first_layer_temperature",
        elefant_foot_compensation: "elefant_foot_compensation",
        resolution: "resolution",
        spiral_mode: "spiral_vase",
        ensure_vertical_shell_thickness: "ensure_vertical_shell_thickness",
        top_surface_pattern: "top_fill_pattern",
        bottom_surface_pattern: "bottom_fill_pattern",
        support_interface_pattern: "support_material_interface_pattern",
        support_base_pattern: "support_material_pattern",
        support_interface_top_layers: "support_material_interface_layers",
        tree_support_branch_angle: "support_tree_angle",
        tree_support_branch_diameter: "support_tree_branch_diameter",
        tree_support_branch_distance: "support_tree_branch_distance"
    };

    const PATTERN_MAP = {
        crosshatch: "grid",
        "zig-zag": "zigzag",
        zigzag: "zigzag"
    };

    const STRIP_SETTING_KEYS = new Set([
        "printer_model",
        "printer_settings_id",
        "printer_variant",
        "printer_notes",
        "printer_structure",
        "printer_technology",
        "printer_extruder_id",
        "printer_extruder_variant",
        "print_compatible_printers",
        "upward_compatible_machine",
        "printable_area",
        "printable_height",
        "bed_exclude_area",
        "bed_custom_model",
        "bed_custom_texture",
        "gcode_flavor",
        "host_type",
        "printhost_authorization_type",
        "printhost_ssl_ignore_revoke",
        "scan_first_layer",
        "silent_mode",
        "thumbnail_size",
        "default_print_profile",
        "default_filament_profile",
        "print_settings_id",
        "from",
        "filename_format",
        "extruder_printable_area",
        "extruder_printable_height",
        "head_wrap_detect_zone",
        "wrapping_exclude_area",
        "nozzle_type",
        "nozzle_volume",
        "nozzle_volume_type",
        "nozzle_height",
        "auxiliary_fan",
        "extruder_ams_count",
        "extruder_type",
        "extruder_variant_list",
        "extruder_max_nozzle_count",
        "extruder_nozzle_stats",
        "extruder_offset",
        "extruder_clearance_dist_to_rod",
        "extruder_clearance_height_to_lid",
        "extruder_clearance_height_to_rod",
        "extruder_clearance_max_radius",
        "physical_extruder_map",
        "print_extruder_id",
        "print_extruder_variant",
        "master_extruder_id",
        "has_filament_switcher",
        "default_nozzle_volume_type",
        "machine_bed_mass_Y",
        "machine_hotend_change_time",
        "machine_load_filament_time",
        "machine_max_printed_mass",
        "machine_max_force_Y",
        "machine_prepare_compensation_time",
        "machine_switch_extruder_time",
        "machine_unload_filament_time",
        "template_custom_gcode",
        "post_process",
        "curr_bed_type"
    ]);

    function normalizePath(p) {
        return String(p || "")
            .replace(/\\/g, "/")
            .replace(/^\/+/, "");
    }

    function pathKey(p) {
        return normalizePath(p).toLowerCase();
    }

    function escapeXml(value) {
        return String(value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");
    }

    function parseAttrs(attrStr) {
        const attrs = {};
        const re = /([:\w.-]+)\s*=\s*"([^"]*)"/g;
        let m;
        while ((m = re.exec(attrStr || ""))) {
            attrs[m[1]] = m[2];
        }
        return attrs;
    }

    function firstValue(value) {
        if (Array.isArray(value)) return value[0];
        return value;
    }

    function asArray(value) {
        if (value == null) return [];
        return Array.isArray(value) ? value : [value];
    }

    function slic3rSerialize(value) {
        if (Array.isArray(value)) return value.map(String).join(";");
        if (value === true) return "1";
        if (value === false) return "0";
        return String(value);
    }

    function mapFillPattern(pattern) {
        if (pattern == null) return pattern;
        const key = String(pattern).toLowerCase();
        return PATTERN_MAP[key] || pattern;
    }

    function shouldStripSettingKey(key) {
        if (STRIP_SETTING_KEYS.has(key)) return true;
        if (key.startsWith("machine_max_") || key.startsWith("machine_min_")) return true;
        if (key.endsWith("_gcode")) return true;
        if (key.startsWith("printhost_")) return true;
        return false;
    }

    function extractBambuSettings(config) {
        if (!config || typeof config !== "object" || Array.isArray(config)) return {};
        if (config.process_settings && typeof config.process_settings === "object") {
            const nested = config.process_settings["1"] || config.process_settings[1];
            if (nested && typeof nested === "object") {
                return { ...config, ...nested };
            }
        }
        return config;
    }

    function mapSettingsToSlic3r(bambuSettings) {
        const out = {};
        if (!bambuSettings) return out;

        for (const [bambuKey, slic3rKey] of Object.entries(BAMBU_TO_SLIC3R)) {
            if (bambuSettings[bambuKey] == null || bambuSettings[bambuKey] === "") continue;
            let value = bambuSettings[bambuKey];

            if (bambuKey === "sparse_infill_pattern") value = mapFillPattern(firstValue(value));
            if (bambuKey === "enable_support" || bambuKey === "detect_thin_wall" || bambuKey === "spiral_mode" || bambuKey === "support_on_build_plate_only") {
                const raw = firstValue(value);
                value = raw === true || raw === "1" || raw === 1 || String(raw).toLowerCase() === "true" ? "1" : "0";
            }
            if (bambuKey === "ironing_type") {
                const raw = String(firstValue(value)).toLowerCase();
                value = raw && raw !== "no ironing" && raw !== "none" ? "1" : "0";
            }
            if (bambuKey === "wall_generator") {
                value = String(firstValue(value)).toLowerCase() === "arachne" ? "arachne" : "classic";
            }
            if (
                bambuKey === "filament_colour" ||
                bambuKey === "filament_type" ||
                bambuKey === "filament_diameter" ||
                bambuKey === "filament_density" ||
                bambuKey === "nozzle_temperature" ||
                bambuKey === "nozzle_temperature_initial_layer"
            ) {
                value = asArray(value);
            } else if (Array.isArray(value)) {
                value = firstValue(value);
            }

            out[slic3rKey] = value;
        }
        return out;
    }

    function sanitizeProjectSettings(config) {
        const merged = extractBambuSettings(config);
        const out = {};
        for (const [key, value] of Object.entries(merged)) {
            if (shouldStripSettingKey(key)) continue;
            out[key] = value;
        }
        return out;
    }

    function buildSlic3rConfig(mapped) {
        const lines = ["; generated by 3MF Sanitizer", ""];
        for (const key of Object.keys(mapped).sort()) {
            lines.push("; " + key + " = " + slic3rSerialize(mapped[key]));
        }
        return lines.join("\n") + "\n";
    }

    function parseModelSettings(xml) {
        const objects = {};
        if (!xml) return objects;
        const objectRe = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
        let m;
        while ((m = objectRe.exec(xml))) {
            const id = parseAttrs(m[1]).id;
            if (!id) continue;
            const body = m[2];
            const meta = {};
            const metaRe = /<metadata\b([^>]*)\/?>/gi;
            let mm;
            while ((mm = metaRe.exec(body))) {
                const attrs = parseAttrs(mm[1]);
                if (attrs.key) meta[attrs.key] = attrs.value;
            }
            const partRe = /<part\b([^>]*)>/gi;
            const parts = [];
            let p;
            while ((p = partRe.exec(body))) {
                parts.push(parseAttrs(p[1]));
            }
            objects[id] = {
                id,
                name: meta.name || "",
                extruder: meta.extruder ? parseInt(meta.extruder, 10) : 1,
                parts
            };
        }
        return objects;
    }

    function extractModelMetadata(xml) {
        const metas = [];
        const modelOpen = xml.match(/<model\b[^>]*>/i);
        if (!modelOpen) return metas;
        const after = xml.slice(xml.indexOf(modelOpen[0]) + modelOpen[0].length);
        const resourcesAt = after.search(/<resources[\s>]/i);
        const head = resourcesAt >= 0 ? after.slice(0, resourcesAt) : after;
        const re = /<metadata\b([^>]*)>([\s\S]*?)<\/metadata>/gi;
        let m;
        while ((m = re.exec(head))) {
            metas.push({ attrs: parseAttrs(m[1]), text: m[2] });
        }
        return metas;
    }

    function extractObjects(xml) {
        const objects = [];
        const re = /<object\b([^>]*)>([\s\S]*?)<\/object>/gi;
        let m;
        while ((m = re.exec(xml))) {
            const attrs = parseAttrs(m[1]);
            const body = m[2];
            objects.push({
                id: attrs.id,
                attrs,
                body,
                hasMesh: /<mesh[\s>]/i.test(body),
                components: extractComponents(body)
            });
        }
        return objects;
    }

    function extractComponents(body) {
        const comps = [];
        const re = /<component\b([^>]*)\/?>/gi;
        let m;
        while ((m = re.exec(body))) {
            const attrs = parseAttrs(m[1]);
            comps.push({
                objectid: attrs.objectid,
                path: attrs["p:path"] || attrs.path || null,
                transform: attrs.transform || null
            });
        }
        return comps;
    }

    function extractBuildItems(xml) {
        const items = [];
        const re = /<item\b([^>]*)\/?>/gi;
        let m;
        while ((m = re.exec(xml))) {
            const attrs = parseAttrs(m[1]);
            items.push({
                objectid: attrs.objectid,
                transform: attrs.transform || null,
                printable: attrs.printable
            });
        }
        return items;
    }

    function parseTransform(str) {
        if (!str) return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        const n = String(str)
            .trim()
            .split(/[\s,]+/)
            .map(Number);
        if (n.length !== 12 || n.some((x) => Number.isNaN(x))) {
            return [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
        }
        return n;
    }

    function multiplyTransform(aStr, bStr) {
        const A = parseTransform(aStr);
        const B = parseTransform(bStr);
        // 3x3 row-major + translation; column-vector compose: out = A * B
        const a00 = A[0], a01 = A[1], a02 = A[2], atx = A[9];
        const a10 = A[3], a11 = A[4], a12 = A[5], aty = A[10];
        const a20 = A[6], a21 = A[7], a22 = A[8], atz = A[11];
        const b00 = B[0], b01 = B[1], b02 = B[2], btx = B[9];
        const b10 = B[3], b11 = B[4], b12 = B[5], bty = B[10];
        const b20 = B[6], b21 = B[7], b22 = B[8], btz = B[11];
        return [
            a00 * b00 + a01 * b10 + a02 * b20,
            a00 * b01 + a01 * b11 + a02 * b21,
            a00 * b02 + a01 * b12 + a02 * b22,
            a10 * b00 + a11 * b10 + a12 * b20,
            a10 * b01 + a11 * b11 + a12 * b21,
            a10 * b02 + a11 * b12 + a12 * b22,
            a20 * b00 + a21 * b10 + a22 * b20,
            a20 * b01 + a21 * b11 + a22 * b21,
            a20 * b02 + a21 * b12 + a22 * b22,
            a00 * btx + a01 * bty + a02 * btz + atx,
            a10 * btx + a11 * bty + a12 * btz + aty,
            a20 * btx + a21 * bty + a22 * btz + atz
        ];
    }

    function formatTransform(m) {
        return m
            .map((n) => {
                if (Object.is(n, -0)) return "0";
                const r = Math.round(n * 1e7) / 1e7;
                return String(r);
            })
            .join(" ");
    }

    function rewriteObjectBody(body, resolveComponentId) {
        return body.replace(/<component\b([^>]*)\/?>/gi, (full, attrStr) => {
            const attrs = parseAttrs(attrStr);
            const newId = resolveComponentId(attrs);
            if (!newId) return "";
            const transform = attrs.transform ? ` transform="${attrs.transform}"` : "";
            return `<component objectid="${newId}"${transform}/>`;
        });
    }

    function stripProductionAttrs(attrStr) {
        return String(attrStr || "")
            .replace(/\s+p:[\w.-]+\s*=\s*"[^"]*"/g, "")
            .replace(/\s+type\s*=\s*"other"/i, ' type="model"');
    }

    function countPaintColors(xml) {
        const matches = String(xml).match(/paint_color="/g);
        return matches ? matches.length : 0;
    }

    function countTriangles(xml) {
        const matches = String(xml).match(/<triangle\b/g);
        return matches ? matches.length : 0;
    }

    function countVertices(xml) {
        const matches = String(xml).match(/<vertex\b/g);
        return matches ? matches.length : 0;
    }

    function displayColor(hex) {
        const raw = String(hex || "#808080").replace(/^#/, "");
        if (raw.length === 8) return "#" + raw.toUpperCase();
        if (raw.length === 6) return "#" + raw.toUpperCase() + "FF";
        return "#808080FF";
    }

    function shouldDropEntry(relativePath) {
        const p = pathKey(relativePath);
        if (p.includes(".gcode")) return true;
        if (p.includes("slice_info")) return true;
        if (p.startsWith("3d/objects/")) return true;
        if (p.startsWith("3d/_rels/")) return true;
        if (p.startsWith("auxiliaries/")) return true;
        if (p.includes("custom_gcode")) return true;
        if (p.includes("filament_settings")) return true;
        if (p.includes("filament_sequence")) return true;
        if (p.includes("cut_information")) return true;
        if (/plate_\d+\.json$/.test(p)) return true;
        if (p.endsWith("metadata/project_settings.config")) return true;
        if (p.endsWith("metadata/model_settings.config")) return true;
        if (p === "[content_types].xml" || p === "_rels/.rels") return true;
        if (p === "3d/3dmodel.model") return true;
        return false;
    }

    function findZipFile(filesByKey, wanted) {
        const key = pathKey(wanted);
        if (filesByKey[key]) return filesByKey[key];
        const noSlash = key.replace(/^\/+/, "");
        return filesByKey[noSlash] || null;
    }

    function indexZipFiles(zip) {
        const filesByKey = {};
        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            filesByKey[pathKey(relativePath)] = { relativePath, entry };
        }
        return filesByKey;
    }

    function collectModelFiles(filesByKey) {
        const models = [];
        for (const rec of Object.values(filesByKey)) {
            if (pathKey(rec.relativePath).endsWith(".model")) models.push(rec);
        }
        return models;
    }

    function parseAllModels(modelXmlByPath) {
        const parsed = {};
        for (const [p, xml] of Object.entries(modelXmlByPath)) {
            parsed[pathKey(p)] = {
                path: normalizePath(p),
                objects: extractObjects(xml),
                buildItems: extractBuildItems(xml),
                metadata: extractModelMetadata(xml),
                xml
            };
        }
        return parsed;
    }

    function getObject(parsedModels, filePath, objectId) {
        const file = parsedModels[pathKey(filePath)];
        if (!file) return null;
        return file.objects.find((o) => String(o.id) === String(objectId)) || null;
    }

    function resolveTarget(parsedModels, filePath, objectId, transform, seen) {
        const mark = pathKey(filePath) + "::" + objectId;
        if (seen.has(mark)) return null;
        seen.add(mark);
        const obj = getObject(parsedModels, filePath, objectId);
        if (!obj) return null;
        if (obj.hasMesh && obj.components.length === 0) {
            return { kind: "mesh", obj, filePath, objectId, transform };
        }
        if (!obj.hasMesh && obj.components.length === 1) {
            const c = obj.components[0];
            const childPath = c.path ? normalizePath(c.path) : filePath;
            return resolveTarget(
                parsedModels,
                childPath,
                c.objectid,
                formatTransform(multiplyTransform(transform, c.transform)),
                seen
            );
        }
        return { kind: "assembly", obj, filePath, objectId, transform };
    }

    function buildBasematerialsXml(id, colors, types) {
        if (!colors.length) {
            colors = ["#808080"];
            types = ["Filament"];
        }
        const bases = colors
            .map((c, i) => {
                const name = escapeXml((types[i] || "Filament") + " " + (i + 1));
                return `  <base name="${name}" displaycolor="${displayColor(c)}"/>`;
            })
            .join("\n");
        return `<basematerials id="${id}">\n${bases}\n </basematerials>`;
    }

    function buildSlic3rModelConfig(objects) {
        const chunks = ['<?xml version="1.0" encoding="UTF-8"?>', "<config>"];
        for (const obj of objects) {
            chunks.push(` <object id="${obj.id}" instancescount="1">`);
            if (obj.name) {
                chunks.push(`  <metadata type="object" key="name" value="${escapeXml(obj.name)}"/>`);
            }
            if (obj.extruder) {
                chunks.push(`  <metadata type="object" key="extruder" value="${obj.extruder}"/>`);
            }
            chunks.push(" </object>");
        }
        chunks.push("</config>", "");
        return chunks.join("\n");
    }

    function buildFlattenedModel({ parsedModels, rootPath, modelSettings, bambuSettings, mappedSettings }) {
        const root = parsedModels[pathKey(rootPath)];
        if (!root) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        const colors = asArray(bambuSettings.filament_colour);
        const types = asArray(bambuSettings.filament_type);
        const materialsId = 1;
        let nextId = 2;

        const meshKeyToId = new Map();
        const emittedMeshes = [];
        const emittedAssemblies = [];
        const buildItems = [];
        const objectMeta = [];
        const logs = [];

        function meshKey(filePath, objectId) {
            return pathKey(filePath) + "::" + objectId;
        }

        function ensureMesh(filePath, objectId, extruder) {
            const key = meshKey(filePath, objectId);
            const existing = meshKeyToId.get(key);
            if (existing) {
                if (existing.extruder && extruder && existing.extruder !== extruder) {
                    const cloneId = nextId++;
                    const src = getObject(parsedModels, filePath, objectId);
                    emittedMeshes.push({
                        id: cloneId,
                        body: src.body,
                        source: key,
                        extruder
                    });
                    return cloneId;
                }
                return existing.id;
            }
            const src = getObject(parsedModels, filePath, objectId);
            if (!src || !src.hasMesh) return null;
            const id = nextId++;
            meshKeyToId.set(key, { id, extruder });
            emittedMeshes.push({ id, body: src.body, source: key, extruder });
            return id;
        }

        function emitAssembly(node, wrapperMeta) {
            const src = node.obj;
            const id = nextId++;
            const resolveComponentId = (attrs) => {
                const childPath = attrs["p:path"] || attrs.path ? normalizePath(attrs["p:path"] || attrs.path) : node.filePath;
                const child = getObject(parsedModels, childPath, attrs.objectid);
                if (!child) return null;
                if (child.hasMesh) return ensureMesh(childPath, attrs.objectid, wrapperMeta.extruder);
                const nested = resolveTarget(parsedModels, childPath, attrs.objectid, attrs.transform, new Set());
                if (!nested) return null;
                if (nested.kind === "mesh") return ensureMesh(nested.filePath, nested.objectId, wrapperMeta.extruder);
                return emitAssembly(nested, wrapperMeta);
            };
            const body = rewriteObjectBody(src.body, resolveComponentId);
            emittedAssemblies.push({ id, body, extruder: wrapperMeta.extruder, name: wrapperMeta.name });
            return id;
        }

        const items = root.buildItems.length
            ? root.buildItems
            : root.objects.map((o) => ({ objectid: o.id, transform: null, printable: "1" }));

        if (!items.length) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        for (const item of items) {
            const wrapper = modelSettings[String(item.objectid)] || {};
            const resolved = resolveTarget(parsedModels, rootPath, item.objectid, item.transform, new Set());
            if (!resolved) {
                logs.push("Skipped unresolved build item objectid=" + item.objectid);
                continue;
            }
            const extruder = wrapper.extruder || 1;
            const name = wrapper.name || "";
            let newId;
            if (resolved.kind === "mesh") {
                newId = ensureMesh(resolved.filePath, resolved.objectId, extruder);
            } else {
                newId = emitAssembly(resolved, { extruder, name });
            }
            if (!newId) continue;
            const printable = item.printable != null ? item.printable : "1";
            buildItems.push({
                objectid: newId,
                transform: resolved.transform,
                printable
            });
            objectMeta.push({ id: newId, name, extruder });
        }

        if (!emittedMeshes.length && !emittedAssemblies.length) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        const keepMetaNames = new Set([
            "Title",
            "Description",
            "Designer",
            "Copyright",
            "License",
            "CreationDate",
            "ModificationDate"
        ]);
        const metadataXml = [];
        for (const meta of root.metadata) {
            const name = meta.attrs.name;
            if (!name || !keepMetaNames.has(name)) continue;
            metadataXml.push(` <metadata name="${escapeXml(name)}">${meta.text}</metadata>`);
        }
        metadataXml.push(` <metadata name="Application">3MF Sanitizer</metadata>`);
        for (const [key, value] of Object.entries(mappedSettings)) {
            metadataXml.push(
                ` <metadata name="slic3r:${escapeXml(key)}">${escapeXml(slic3rSerialize(value))}</metadata>`
            );
        }

        const pindexFor = (extruder) => {
            if (!colors.length) return 0;
            const idx = Math.max(0, (extruder || 1) - 1);
            return Math.min(idx, colors.length - 1);
        };

        const resourceXml = [];
        resourceXml.push(" " + buildBasematerialsXml(materialsId, colors, types));

        for (const mesh of emittedMeshes) {
            const cleanedBody = rewriteObjectBody(mesh.body, () => null).replace(/p:[\w.-]+\s*=\s*"[^"]*"\s*/g, "");
            const pindex = pindexFor(mesh.extruder);
            resourceXml.push(
                ` <object id="${mesh.id}" type="model" pid="${materialsId}" pindex="${pindex}">${cleanedBody}</object>`
            );
        }
        for (const assem of emittedAssemblies) {
            const pindex = pindexFor(assem.extruder);
            resourceXml.push(
                ` <object id="${assem.id}" type="model" pid="${materialsId}" pindex="${pindex}">${assem.body}</object>`
            );
        }

        const buildXml = buildItems
            .map((item) => {
                const t = item.transform ? ` transform="${item.transform}"` : "";
                const printable = item.printable != null ? ` printable="${item.printable}"` : "";
                return `  <item objectid="${item.objectid}"${t}${printable}/>`;
            })
            .join("\n");

        const xml = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            `<model unit="millimeter" xml:lang="en-US" xmlns="${CORE_NS}">`,
            metadataXml.join("\n"),
            " <resources>",
            resourceXml.join("\n"),
            " </resources>",
            " <build>",
            buildXml,
            " </build>",
            "</model>",
            ""
        ].join("\n");

        return {
            xml,
            objectMeta,
            logs,
            stats: {
                objects: emittedMeshes.length + emittedAssemblies.length,
                buildItems: buildItems.length,
                vertices: countVertices(xml),
                triangles: countTriangles(xml),
                paintColors: countPaintColors(xml),
                materials: colors.length || 1
            }
        };
    }

    function contentTypesXml() {
        return [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">',
            ' <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>',
            ' <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>',
            ' <Default Extension="png" ContentType="image/png"/>',
            ' <Default Extension="config" ContentType="application/octet-stream"/>',
            "</Types>",
            ""
        ].join("\n");
    }

    function relsXml(hasThumbnail) {
        const rels = [
            '<?xml version="1.0" encoding="UTF-8"?>',
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">',
            ` <Relationship Target="/3D/3dmodel.model" Id="rel-1" Type="${MODEL_REL}"/>`
        ];
        if (hasThumbnail) {
            rels.push(` <Relationship Target="/Metadata/thumbnail.png" Id="rel-2" Type="${THUMB_REL}"/>`);
        }
        rels.push("</Relationships>", "");
        return rels.join("\n");
    }

    function logLine(log, message) {
        if (typeof log === "function") log(message);
    }

    async function sanitize3mf(JSZip, input, options) {
        const opts = options || {};
        const log = opts.log || function () {};
        const zip = await JSZip.loadAsync(input);
        const filesByKey = indexZipFiles(zip);

        const rootRec =
            findZipFile(filesByKey, "3D/3dmodel.model") || findZipFile(filesByKey, "3d/3dmodel.model");
        if (!rootRec) {
            throw new Error("No valid 3D model found inside the 3MF file.");
        }

        let bambuSettings = {};
        const projectRec = findZipFile(filesByKey, "Metadata/project_settings.config");
        if (projectRec) {
            logLine(log, "Found Bambu/Orca print settings. Extracting designer process settings...");
            try {
                const parsed = JSON.parse(await projectRec.entry.async("string"));
                bambuSettings = extractBambuSettings(parsed);
                logLine(
                    log,
                    `Extracted walls=${bambuSettings.wall_loops || "default"}, layer=${bambuSettings.layer_height || "default"}, line width=${bambuSettings.line_width || "default"}, infill=${bambuSettings.sparse_infill_density || "default"}`
                );
            } catch (e) {
                logLine(log, "Warning: Could not parse project_settings.config JSON.");
            }
        }

        let modelSettings = {};
        const modelSetRec = findZipFile(filesByKey, "Metadata/model_settings.config");
        if (modelSetRec) {
            try {
                modelSettings = parseModelSettings(await modelSetRec.entry.async("string"));
                logLine(log, `Read per-object extruder/color assignments for ${Object.keys(modelSettings).length} object(s).`);
            } catch (e) {
                logLine(log, "Warning: Could not parse model_settings.config.");
            }
        }

        const modelXmlByPath = {};
        for (const rec of collectModelFiles(filesByKey)) {
            modelXmlByPath[normalizePath(rec.relativePath)] = await rec.entry.async("string");
        }

        const parsedModels = parseAllModels(modelXmlByPath);
        const mappedSettings = mapSettingsToSlic3r(bambuSettings);
        const flattened = buildFlattenedModel({
            parsedModels,
            rootPath: rootRec.relativePath,
            modelSettings,
            bambuSettings,
            mappedSettings
        });
        flattened.logs.forEach((line) => logLine(log, line));

        const hadProduction = Object.keys(modelXmlByPath).some((p) => /objects\/object_/i.test(p)) ||
            /requiredextensions\s*=\s*"p"/i.test(modelXmlByPath[normalizePath(rootRec.relativePath)] || "");
        if (hadProduction) {
            logLine(log, "Flattened 3MF Production Extension into a single core 3dmodel.model (required for Cura/Prusa/Anycubic).");
        }
        logLine(log, `Preserved geometry: ${flattened.stats.vertices} vertices, ${flattened.stats.triangles} triangles, ${flattened.stats.paintColors} painted faces.`);
        logLine(log, `Preserved ${flattened.stats.materials} filament color(s) as 3MF basematerials.`);

        const newZip = new JSZip();
        newZip.file("[Content_Types].xml", contentTypesXml());

        let hasThumbnail = false;
        const plateThumb =
            findZipFile(filesByKey, "Metadata/plate_1.png") ||
            findZipFile(filesByKey, "Metadata/thumbnail.png") ||
            findZipFile(filesByKey, "Metadata/top_1.png");
        if (plateThumb) {
            newZip.file("Metadata/thumbnail.png", await plateThumb.entry.async("uint8array"));
            hasThumbnail = true;
        }
        newZip.file("_rels/.rels", relsXml(hasThumbnail));
        newZip.file("3D/3dmodel.model", flattened.xml);

        const cleanedProject = sanitizeProjectSettings(bambuSettings);
        if (Object.keys(cleanedProject).length) {
            newZip.file("Metadata/project_settings.config", JSON.stringify(cleanedProject, null, 2));
            logLine(log, `Wrote sanitized process/filament settings (${Object.keys(cleanedProject).length} keys). Printer/machine profile stripped.`);
        }
        if (Object.keys(mappedSettings).length) {
            newZip.file("Metadata/Slic3r_PE.config", buildSlic3rConfig(mappedSettings));
            logLine(log, "Wrote PrusaSlicer/Anycubic Slic3r_PE.config (walls, line width, infill, supports, colors).");
        }
        if (flattened.objectMeta.length) {
            newZip.file("Metadata/Slic3r_PE_model.config", buildSlic3rModelConfig(flattened.objectMeta));
        }

        for (const [relativePath, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            if (shouldDropEntry(relativePath)) {
                if (
                    pathKey(relativePath).includes(".gcode") ||
                    pathKey(relativePath).includes("slice_info") ||
                    pathKey(relativePath).includes("project_settings")
                ) {
                    logLine(log, "Stripping proprietary/cached data: " + relativePath);
                }
                continue;
            }
            if (pathKey(relativePath) === "metadata/thumbnail.png" && hasThumbnail) continue;
            logLine(log, "Preserving asset: " + relativePath);
            newZip.file(relativePath, await entry.async("uint8array"));
        }

        const bytes = await newZip.generateAsync({
            type: "uint8array",
            compression: "DEFLATE",
            compressionOptions: { level: 6 }
        });

        return {
            bytes,
            report: {
                settings: mappedSettings,
                projectKeys: Object.keys(cleanedProject).sort(),
                ...flattened.stats,
                flattened: hadProduction
            }
        };
    }

    return {
        sanitize3mf,
        extractBambuSettings,
        mapSettingsToSlic3r,
        sanitizeProjectSettings,
        buildSlic3rConfig,
        parseModelSettings,
        shouldDropEntry,
        shouldStripSettingKey,
        mapFillPattern,
        multiplyTransform,
        formatTransform,
        parseTransform,
        displayColor,
        BAMBU_TO_SLIC3R
    };
});
