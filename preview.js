/**
 * Side-by-side Source / Sanitized 3MF preview using Three.js.
 * Orbit is implemented here so we do not depend on THREE.OrbitControls,
 * which modern Three UMD builds no longer attach.
 */
(function (root) {
    "use strict";

    let views = [];
    let syncing = false;
    let rafId = 0;

    function createOrbitControls(camera, domElement) {
        const target = new THREE.Vector3();
        const spherical = new THREE.Spherical();
        const sphericalDelta = new THREE.Spherical();
        const panOffset = new THREE.Vector3();
        const offset = new THREE.Vector3();
        const lastPosition = new THREE.Vector3();
        const lastTarget = new THREE.Vector3();
        const rotateStart = new THREE.Vector2();
        const panStart = new THREE.Vector2();
        const changeListeners = [];
        const quat = new THREE.Quaternion().setFromUnitVectors(camera.up, new THREE.Vector3(0, 1, 0));
        const quatInverse = quat.clone().invert();
        let scale = 1;
        let state = 0;
        let pointerId = null;

        function notify() {
            changeListeners.forEach((fn) => fn());
        }

        function pan(deltaX, deltaY) {
            offset.copy(camera.position).sub(target);
            let targetDistance = offset.length() * Math.tan((camera.fov / 2) * Math.PI / 180);
            const panLeft = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
            panLeft.multiplyScalar(-2 * deltaX * targetDistance / (domElement.clientHeight || 1));
            const panUp = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
            panUp.multiplyScalar(2 * deltaY * targetDistance / (domElement.clientHeight || 1));
            panOffset.add(panLeft).add(panUp);
        }

        function onPointerDown(event) {
            if (pointerId !== null) return;
            pointerId = event.pointerId;
            domElement.setPointerCapture(pointerId);
            if (event.button === 2 || event.button === 1 || event.shiftKey) {
                state = 2;
                panStart.set(event.clientX, event.clientY);
            } else {
                state = 1;
                rotateStart.set(event.clientX, event.clientY);
            }
        }

        function onPointerMove(event) {
            if (event.pointerId !== pointerId) return;
            if (state === 1) {
                const height = domElement.clientHeight || 1;
                sphericalDelta.theta -= (2 * Math.PI * (event.clientX - rotateStart.x)) / height;
                sphericalDelta.phi -= (2 * Math.PI * (event.clientY - rotateStart.y)) / height;
                rotateStart.set(event.clientX, event.clientY);
            } else if (state === 2) {
                pan(event.clientX - panStart.x, event.clientY - panStart.y);
                panStart.set(event.clientX, event.clientY);
            }
        }

        function onPointerUp(event) {
            if (event.pointerId !== pointerId) return;
            pointerId = null;
            state = 0;
            try {
                domElement.releasePointerCapture(event.pointerId);
            } catch (_) {
                /* already released */
            }
        }

        function onWheel(event) {
            event.preventDefault();
            scale *= event.deltaY > 0 ? 1.12 : 0.88;
        }

        function onContextMenu(event) {
            event.preventDefault();
        }

        domElement.addEventListener("pointerdown", onPointerDown);
        domElement.addEventListener("pointermove", onPointerMove);
        domElement.addEventListener("pointerup", onPointerUp);
        domElement.addEventListener("pointercancel", onPointerUp);
        domElement.addEventListener("wheel", onWheel, { passive: false });
        domElement.addEventListener("contextmenu", onContextMenu);
        domElement.style.touchAction = "none";
        domElement.style.cursor = "grab";

        return {
            target,
            enableDamping: true,
            dampingFactor: 0.08,
            addEventListener(type, fn) {
                if (type === "change") changeListeners.push(fn);
            },
            update() {
                const damping = this.enableDamping ? this.dampingFactor : 1;
                offset.copy(camera.position).sub(target);
                offset.applyQuaternion(quat);
                spherical.setFromVector3(offset);
                spherical.theta += sphericalDelta.theta * damping;
                spherical.phi += sphericalDelta.phi * damping;
                spherical.radius = Math.max(0.1, spherical.radius * scale);
                spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi));
                spherical.makeSafe();
                if (this.enableDamping) {
                    sphericalDelta.theta *= 1 - this.dampingFactor;
                    sphericalDelta.phi *= 1 - this.dampingFactor;
                    target.addScaledVector(panOffset, this.dampingFactor);
                    panOffset.multiplyScalar(1 - this.dampingFactor);
                } else {
                    sphericalDelta.set(0, 0, 0);
                    target.add(panOffset);
                    panOffset.set(0, 0, 0);
                }
                scale = 1;
                offset.setFromSpherical(spherical);
                offset.applyQuaternion(quatInverse);
                camera.position.copy(target).add(offset);
                camera.lookAt(target);
                if (lastPosition.distanceToSquared(camera.position) > 1e-8 || lastTarget.distanceToSquared(target) > 1e-8) {
                    lastPosition.copy(camera.position);
                    lastTarget.copy(target);
                    notify();
                }
                return true;
            },
            dispose() {
                domElement.removeEventListener("pointerdown", onPointerDown);
                domElement.removeEventListener("pointermove", onPointerMove);
                domElement.removeEventListener("pointerup", onPointerUp);
                domElement.removeEventListener("pointercancel", onPointerUp);
                domElement.removeEventListener("wheel", onWheel);
                domElement.removeEventListener("contextmenu", onContextMenu);
            }
        };
    }

    function disposeViews() {
        if (rafId) {
            cancelAnimationFrame(rafId);
            rafId = 0;
        }
        views.forEach((view) => {
            if (view.controls) view.controls.dispose();
            if (view.renderer) {
                view.renderer.dispose();
                view.renderer.forceContextLoss();
            }
            if (view.scene) {
                view.scene.traverse((obj) => {
                    if (obj.geometry) obj.geometry.dispose();
                    if (obj.material) obj.material.dispose();
                });
            }
        });
        views = [];
    }

    function fitCamera(camera, controls, object) {
        const box = new THREE.Box3().setFromObject(object);
        if (!isFinite(box.min.x)) {
            camera.position.set(40, 30, 40);
            controls.target.set(0, 0, 0);
            return;
        }
        const center = box.getCenter(new THREE.Vector3());
        const size = Math.max(box.getSize(new THREE.Vector3()).length(), 1);
        camera.position.set(center.x + size * 0.85, center.y + size * 0.65, center.z + size * 0.85);
        controls.target.copy(center);
        camera.near = Math.max(size / 200, 0.01);
        camera.far = size * 40;
        camera.updateProjectionMatrix();
        controls.update();
    }

    function buildScene(meshes) {
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x0f172a);
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const key = new THREE.DirectionalLight(0xffffff, 0.85);
        key.position.set(40, 80, 50);
        scene.add(key);
        const fill = new THREE.DirectionalLight(0x93c5fd, 0.35);
        fill.position.set(-50, 20, -30);
        scene.add(fill);

        const group = new THREE.Group();
        group.rotation.x = -Math.PI / 2;
        meshes.forEach((mesh) => {
            const geometry = new THREE.BufferGeometry();
            geometry.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
            geometry.setAttribute("color", new THREE.Float32BufferAttribute(mesh.colors, 3));
            geometry.computeVertexNormals();
            const material = new THREE.MeshStandardMaterial({
                vertexColors: true,
                metalness: 0.05,
                roughness: 0.55,
                side: THREE.DoubleSide
            });
            group.add(new THREE.Mesh(geometry, material));
        });
        scene.add(group);
        group.updateMatrixWorld(true);
        return { scene, model: group };
    }

    function createView(canvas, meshes) {
        const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        const width = canvas.clientWidth || 360;
        const height = canvas.clientHeight || 256;
        renderer.setSize(width, height, false);
        const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 2000);
        const controls = createOrbitControls(camera, canvas);
        const built = buildScene(meshes);
        fitCamera(camera, controls, built.model);
        return { canvas, renderer, camera, controls, scene: built.scene };
    }

    function syncFrom(source) {
        if (syncing) return;
        syncing = true;
        views.forEach((view) => {
            if (view === source) return;
            view.camera.position.copy(source.camera.position);
            view.camera.quaternion.copy(source.camera.quaternion);
            view.controls.target.copy(source.controls.target);
            view.camera.updateProjectionMatrix();
        });
        syncing = false;
    }

    function resizeViews() {
        views.forEach((view) => {
            const width = view.canvas.clientWidth || 360;
            const height = view.canvas.clientHeight || 256;
            view.renderer.setSize(width, height, false);
            view.camera.aspect = width / height;
            view.camera.updateProjectionMatrix();
        });
    }

    function tick() {
        views.forEach((view) => {
            view.controls.update();
            view.renderer.render(view.scene, view.camera);
        });
        rafId = requestAnimationFrame(tick);
    }

    function renderPair(sourceCanvas, sanitizedCanvas, sourcePreview, sanitizedPreview) {
        if (typeof THREE === "undefined") {
            throw new Error("3D preview libraries failed to load.");
        }
        disposeViews();
        const sourceView = createView(sourceCanvas, (sourcePreview && sourcePreview.meshes) || []);
        const sanitizedView = createView(sanitizedCanvas, (sanitizedPreview && sanitizedPreview.meshes) || []);
        views = [sourceView, sanitizedView];
        views.forEach((view) => {
            view.controls.addEventListener("change", () => syncFrom(view));
        });
        window.addEventListener("resize", resizeViews);
        resizeViews();
        tick();
    }

    root.ThreeMFPreview = {
        renderPair,
        dispose: disposeViews
    };
})(typeof globalThis !== "undefined" ? globalThis : this);
