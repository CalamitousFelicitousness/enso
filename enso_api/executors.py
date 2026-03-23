"""V2 job executors.

Each executor calls through to the same backend processing code as the
corresponding v1 endpoint.  This ensures both API versions produce
identical results:

    v2 generate  -> modules.control.run.control_run()          (same as v1 /control, /txt2img, /img2img)
    v2 upscale   -> modules.postprocessing.run_extras()        (same as v1 /extra-single-image)
    v2 caption   -> modules.api.caption.do_vqa/openclip/tagger (same as v1 /vqa, /openclip, /tagger)
    v2 enhance   -> scripts.prompt_enhance.enhance()           (same as v1 /prompt-enhance)
    v2 detect    -> shared.yolo.predict()                      (same as v1 /detect)
    v2 preprocess-> modules.control.processors.Processor       (same as v1 /preprocess)
    v2 model-load-> modules.sd_models.reload_model_weights()   (v2-only, replaces v1 poll-based reload)
    v2 model-merge  -> modules.extras.run_modelmerger()        (v2-only, job-based merge)
    v2 model-replace-> modules.extras.run_model_modules()      (v2-only, job-based component replace)
    v2 model-save   -> modules.sd_models.save_model()          (v2-only, job-based save)
    v2 loader-load  -> modules.ui_models_load.load_model()     (v2-only, job-based component loader)
    v2 lora-extract -> modules.lora.lora_extract.make_lora()   (v2-only, job-based LoRA extraction)
    v2 hf-download  -> modules.models_hf.hf_download_model()   (v2-only, job-based HF download)
    v2 rembg     -> modules.rembg.ben2 / rembg.remove()        (same as v1 /rembg)

Do NOT duplicate processing logic here.  If v1 has a function for it,
call that function.
"""

import os
import inspect
from modules.logger import log


def execute_generate(params: dict, job_id: str) -> dict:
    from modules import shared, processing_helpers
    from modules.api import helpers
    from modules.control import run as control_run_module
    from modules.control.unit import Unit

    # Decode base64 images
    inputs = [helpers.decode_base64_to_image(x) for x in params.get('inputs', [])] if params.get('inputs') else None
    inits = [helpers.decode_base64_to_image(x) for x in params.get('inits', [])] if params.get('inits') else None
    mask = helpers.decode_base64_to_image(params['mask']) if params.get('mask') else None

    # Merge asset unit images (init_control) into inits
    init_control = params.get('init_control')
    if init_control:
        extra_inits = [helpers.decode_base64_to_image(x) for x in init_control]
        inits = (inits or []) + extra_inits

    # Build units from control dicts
    units = []
    control_dicts = params.get('control') or []
    for u in control_dicts:
        if not isinstance(u, dict):
            continue
        unit = Unit(
            enabled=True,
            unit_type=u.get('unit_type', 'controlnet'),
            model_id=u.get('model', ''),
            process_id=u.get('process', ''),
            strength=u.get('strength', 1.0),
            start=u.get('start', 0.0),
            end=u.get('end', 1.0),
        )
        unit.guess = u.get('guess', False)
        unit.factor = u.get('factor', 1.0)
        unit.attention = u.get('attention', 'Attention')
        unit.fidelity = u.get('fidelity', 0.5)
        unit.query_weight = u.get('query_weight', 1.0)
        unit.adain_weight = u.get('adain_weight', 1.0)
        unit.process_params = u.get('process_params') or {}
        unit.update_choices(u.get('model', ''))
        mode = u.get('mode', 'default')
        if mode != 'default' and unit.choices and mode in unit.choices:
            unit.mode = mode
        elif unit.choices:
            unit.mode = unit.choices[0]
        if unit.process is not None:
            unit.process.override = None
        override_b64 = u.get('override') or u.get('image')
        if override_b64:
            unit.override = helpers.decode_base64_to_image(override_b64)
        units.append(unit)

    # Build IP adapter args
    ip_adapter_args = {}
    ip_adapter_list = params.get('ip_adapter') or []
    if ip_adapter_list:
        ip_adapter_args = {'ip_adapter_names': [], 'ip_adapter_scales': [], 'ip_adapter_crops': [], 'ip_adapter_starts': [], 'ip_adapter_ends': [], 'ip_adapter_images': [], 'ip_adapter_masks': []}
        for ipa in ip_adapter_list:
            if not isinstance(ipa, dict) or not ipa.get('images'):
                continue
            ip_adapter_args['ip_adapter_names'].append(ipa.get('adapter', ''))
            ip_adapter_args['ip_adapter_scales'].append(ipa.get('scale', 1.0))
            ip_adapter_args['ip_adapter_starts'].append(ipa.get('start', 0.0))
            ip_adapter_args['ip_adapter_ends'].append(ipa.get('end', 1.0))
            ip_adapter_args['ip_adapter_crops'].append(ipa.get('crop', False))
            ip_adapter_args['ip_adapter_images'].append([helpers.decode_base64_to_image(x) for x in ipa['images']])
            if ipa.get('masks'):
                ip_adapter_args['ip_adapter_masks'].append([helpers.decode_base64_to_image(x) for x in ipa['masks']])

    save_images = params.get('save_images', True)
    sampler_name = params.get('sampler_name', 'Default')
    sampler_index = processing_helpers.get_sampler_index(sampler_name)

    # Build args dict for control_run, only passing params it accepts
    valid_params = set(inspect.signature(control_run_module.control_run).parameters.keys())
    skip_keys = {'type', 'inputs', 'inits', 'mask', 'control', 'init_control', 'ip_adapter', 'save_images', 'sampler_name', 'script_name', 'script_args', 'alwayson_scripts', 'extra', 'priority'}
    run_args = {k: v for k, v in params.items() if k in valid_params and k not in skip_keys}
    run_args['sampler_index'] = sampler_index
    run_args['is_generator'] = True
    run_args['inputs'] = inputs
    run_args['inits'] = inits
    run_args['mask'] = mask
    run_args['units'] = units
    if units:
        run_args['unit_type'] = units[0].type

    extra = params.get('extra', {}) or {}
    run_args['extra'] = extra

    extra_p_args = {
        'do_not_save_grid': not save_images,
        'do_not_save_samples': not save_images,
        **ip_adapter_args,
    }

    override_script_name = params.get('script_name')
    override_script_args = params.get('script_args', [])
    if override_script_name:
        run_args['override_script_name'] = override_script_name
        run_args['override_script_args'] = override_script_args

    # Apply masking options from request params (reset ALL opts to prevent stale values from triggering expensive operations like SAM segmentation)
    if mask is not None:
        from modules import masking
        # mask_blur from API is in pixels; masking.opts expects a fraction of image size
        # Convert using the same formula as the legacy path: fraction = round(4 * px / size, 3)
        mask_blur_px = params.get('mask_blur', 0)
        size = min(params.get('width', 512), params.get('height', 512))
        masking.opts.mask_blur = round(4 * mask_blur_px / size, 3) if mask_blur_px > 0 and size > 0 else 0
        masking.opts.mask_only = params.get('inpaint_full_res', False)
        masking.opts.invert = params.get('inpainting_mask_invert', 0) == 1
        masking.opts.auto_mask = 'None'
        masking.opts.auto_segment = 'None'
        masking.opts.mask_erode = 0
        masking.opts.mask_dilate = 0
        extra_p_args['inpaint_full_res_padding'] = params.get('inpaint_full_res_padding', 32)

    # Run generation
    jobid = shared.state.begin('API-V2', api=True)
    try:
        control_run_module.control_set(extra_p_args)
        res = control_run_module.control_run(**run_args)

        output_images = []
        output_processed = []
        for item in res:
            if len(item) > 0 and (isinstance(item[0], list) or item[0] is None):
                output_images += item[0] if item[0] is not None else []
            if len(item) > 1 and item[1] is not None:
                output_processed.append(item[1])

        # Capture saved file paths BEFORE end() clears state.results
        saved_paths = list(shared.state.results) if hasattr(shared.state, 'results') and shared.state.results else []
    finally:
        shared.state.end(jobid)

    # Collect saved file paths
    image_refs = []

    for i, img in enumerate(output_images):
        path = saved_paths[i] if i < len(saved_paths) else None
        if path and os.path.isfile(str(path)):
            path = str(path)
            ext = os.path.splitext(path)[1].lstrip('.').lower()
            image_refs.append({
                'index': i,
                'path': path,
                'url': f'/sdapi/v2/jobs/{job_id}/images/{i}',
                'width': img.width if hasattr(img, 'width') else 0,
                'height': img.height if hasattr(img, 'height') else 0,
                'format': ext if ext else 'png',
                'size': os.path.getsize(path),
            })
        elif img is not None:
            if save_images:
                # Fallback: save image manually if not saved by the pipeline
                from modules import images as img_module
                from modules.paths import resolve_output_path
                try:
                    output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_txt2img_samples if not inits else shared.opts.outdir_img2img_samples)
                    path_info = img_module.save_image(img, output_dir, "", seed=params.get('seed', -1), prompt=params.get('prompt', ''))
                    if path_info and len(path_info) > 0:
                        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
                        if os.path.isfile(str(fpath)):
                            ext = os.path.splitext(str(fpath))[1].lstrip('.').lower()
                            image_refs.append({
                                'index': i,
                                'path': str(fpath),
                                'url': f'/sdapi/v2/jobs/{job_id}/images/{i}',
                                'width': img.width if hasattr(img, 'width') else 0,
                                'height': img.height if hasattr(img, 'height') else 0,
                                'format': ext if ext else 'png',
                                'size': os.path.getsize(str(fpath)),
                            })
                except Exception as e:
                    log.warning(f'Job {job_id}: failed to save fallback image {i}: {e}')
            else:
                # save_images=False: stage to temp dir so images are still downloadable
                from enso_api.temp_store import stage_image
                try:
                    staged = stage_image(job_id, i, img)
                    if staged:
                        image_refs.append({
                            'index': i,
                            'path': staged['path'],
                            'url': f'/sdapi/v2/jobs/{job_id}/images/{i}',
                            'width': staged['width'],
                            'height': staged['height'],
                            'format': staged['format'],
                            'size': staged['size'],
                            'temp': True,
                        })
                except Exception as e:
                    log.warning(f'Job {job_id}: failed to stage temp image {i}: {e}')

    # Save processed control images to disk and build refs
    processed_refs = []
    if output_processed:
        from modules import images as img_module
        from modules.paths import resolve_output_path
        output_dir = resolve_output_path(shared.opts.outdir_samples, shared.opts.outdir_extras_samples if hasattr(shared.opts, 'outdir_extras_samples') else shared.opts.outdir_txt2img_samples)
        for pi, proc_img in enumerate(output_processed):
            try:
                path_info = img_module.save_image(proc_img, output_dir, "control-", prompt="processed")
                fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info) if path_info else None
                if fpath and os.path.isfile(str(fpath)):
                    fpath = str(fpath)
                    ext = os.path.splitext(fpath)[1].lstrip('.').lower()
                    processed_refs.append({
                        'index': pi,
                        'path': fpath,
                        'url': f'/sdapi/v2/jobs/{job_id}/processed/{pi}',
                        'width': proc_img.width if hasattr(proc_img, 'width') else 0,
                        'height': proc_img.height if hasattr(proc_img, 'height') else 0,
                        'format': ext or 'png',
                        'size': os.path.getsize(fpath),
                    })
            except Exception as e:
                log.warning(f'Job {job_id}: failed to save processed image {pi}: {e}')

    result = {'images': image_refs, 'processed': processed_refs, 'info': {}, 'params': {k: v for k, v in params.items() if k != 'type'}}
    if not save_images and image_refs:
        from enso_api.temp_store import get_staging_dir
        root = get_staging_dir()
        if root:
            result['_staging_dir'] = os.path.join(root, job_id)
    return result


def execute_upscale(params: dict, job_id: str) -> dict:
    from modules import shared, postprocessing
    from modules.api import helpers

    image = helpers.decode_base64_to_image(params.get('image', ''))
    upscaler = params.get('upscaler', 'None')
    scale = params.get('scale', 2.0)
    resize_mode = params.get('resize_mode', 0)
    width = params.get('width', 0)
    height = params.get('height', 0)
    crop = params.get('crop', True)
    upscaler_2 = params.get('upscaler_2', 'None')
    upscaler_2_visibility = params.get('upscaler_2_visibility', 0.0)

    jobid = shared.state.begin('API-V2-UP', api=True)
    try:
        result = postprocessing.run_extras(
            extras_mode=0, resize_mode=resize_mode,
            image=image, image_folder="", input_dir="", output_dir="",
            show_extras_results=False, save_output=True,
            extras_upscaler_1=upscaler, upscaling_resize=scale,
            upscaling_resize_w=width, upscaling_resize_h=height,
            upscaling_crop=crop,
            extras_upscaler_2=upscaler_2, extras_upscaler_2_visibility=upscaler_2_visibility,
        )
        saved_paths = list(shared.state.results) if hasattr(shared.state, 'results') and shared.state.results else []
    finally:
        shared.state.end(jobid)

    output_image = result[0][0] if result and result[0] else None
    image_refs = []
    if output_image is not None:
        if saved_paths and os.path.isfile(str(saved_paths[0])):
            path = str(saved_paths[0])
            ext = os.path.splitext(path)[1].lstrip('.').lower()
            image_refs.append({'index': 0, 'path': path, 'url': f'/sdapi/v2/jobs/{job_id}/images/0', 'width': output_image.width, 'height': output_image.height, 'format': ext or 'png', 'size': os.path.getsize(path)})

    return {'images': image_refs, 'info': {}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


def execute_caption(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import shared
    from modules.api import helpers

    backend = params.get('backend', 'vlm')
    image = helpers.decode_base64_to_image(params.get('image', ''))
    model = params.get('model')

    jobid = shared.state.begin('API-V2-CAP', api=True)
    try:
        if backend == 'vlm':
            from modules.api.caption import do_vqa, ReqVQA
            req = ReqVQA(image='', model=model, prompt=params.get('prompt'))
            answer, _annotated = do_vqa(image, req)
            caption_text = answer
        elif backend == 'openclip':
            from modules.api.caption import do_openclip, ReqCaptionOpenCLIP
            req = ReqCaptionOpenCLIP(image='', model=model)
            caption_text, *_ = do_openclip(image, req)
        elif backend == 'tagger':
            from modules.api.caption import do_tagger, ReqTagger
            req = ReqTagger(image='', model=model)
            tags, _scores = do_tagger(image, req)
            caption_text = tags
        else:
            raise ValueError(f"Unknown caption backend: {backend}")
    finally:
        shared.state.end(jobid)

    return {'images': [], 'info': {'caption': caption_text}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


def execute_enhance(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import shared, processing_helpers
    from modules.api import helpers

    prompt = params.get('prompt', '')
    model = params.get('model')
    enhance_type = params.get('enhance_type', 'text')
    seed = processing_helpers.get_fixed_seed(params.get('seed', -1))
    image = helpers.decode_base64_to_image(params['image']) if params.get('image') else None

    jobid = shared.state.begin('API-V2-ENH', api=True)
    try:
        if enhance_type == 'video':
            from modules.ui_video_vlm import enhance_prompt
            default_model = 'Google Gemma 3 4B' if model is None or len(model) < 4 else model
            result_prompt = enhance_prompt(enable=True, image=image, prompt=prompt, model=default_model, system_prompt=params.get('system_prompt', ''), nsfw=params.get('nsfw', False))
        else:
            from modules.scripts_manager import scripts_txt2img
            default_model = 'google/gemma-3-4b-it' if enhance_type == 'image' else 'google/gemma-3-1b-it'
            use_model = default_model if model is None or len(model) < 4 else model
            instance = next(s for s in scripts_txt2img.scripts if 'prompt_enhance.py' in s.filename)
            result_prompt = instance.enhance(
                model=use_model, prompt=prompt,
                system=params.get('system_prompt', ''), prefix=params.get('prefix', ''), suffix=params.get('suffix', ''),
                sample=params.get('do_sample', True), tokens=params.get('max_tokens', 256),
                temperature=params.get('temperature', 0.7), penalty=params.get('repetition_penalty', 1.2),
                top_k=params.get('top_k', 50), top_p=params.get('top_p', 0.9),
                thinking=params.get('thinking', False), keep_thinking=params.get('keep_thinking', False),
                use_vision=params.get('use_vision', False), prefill=params.get('prefill', ''),
                keep_prefill=params.get('keep_prefill', False), image=image, seed=seed,
                nsfw=params.get('nsfw', False),
            )
    finally:
        shared.state.end(jobid)

    return {'images': [], 'info': {'prompt': result_prompt, 'seed': seed}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


def execute_detect(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    from modules import shared
    from modules.api import helpers
    from modules.shared import yolo

    image = helpers.decode_base64_to_image(params.get('image', ''))
    model = params.get('model')

    jobid = shared.state.begin('API-V2-DET', api=True)
    try:
        items = yolo.predict(model, image)
        detections = []
        for item in items:
            detections.append({
                'label': item.label,
                'score': item.score,
                'cls': item.cls,
                'box': item.box,
            })
    finally:
        shared.state.end(jobid)

    return {'images': [], 'info': {'detections': detections}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


def execute_preprocess(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.control import processors

    image = helpers.decode_base64_to_image(params.get('image', ''))
    model = params.get('model', '')
    proc_params = params.get('params', {}) or {}

    processors_list = list(processors.config)
    if model not in processors_list:
        raise ValueError(f"Processor model not found: {model}")

    jobid = shared.state.begin('API-V2-PRE', api=True)
    try:
        proc = processors.Processor(model)
        processed = proc(image, local_config=proc_params)
        # Save processed image to disk
        from modules import images as img_module
        output_dir = shared.opts.outdir_extras_samples if hasattr(shared.opts, 'outdir_extras_samples') else shared.opts.outdir_txt2img_samples
        path_info = img_module.save_image(processed, output_dir, "", prompt=f"preprocess-{model}")
    finally:
        shared.state.end(jobid)

    image_refs = []
    if path_info:
        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
        if os.path.isfile(str(fpath)):
            ext = os.path.splitext(str(fpath))[1].lstrip('.').lower()
            image_refs.append({'index': 0, 'path': str(fpath), 'url': f'/sdapi/v2/jobs/{job_id}/images/0', 'width': processed.width, 'height': processed.height, 'format': ext or 'png', 'size': os.path.getsize(str(fpath))})

    return {'images': image_refs, 'info': {'model': model}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


def execute_video(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.video_models import video_run, video_ui

    engine = params.get('engine', '')
    model = params.get('model', '')
    prompt = params.get('prompt', '')
    negative = params.get('negative', '')
    width = params.get('width', 848)
    height = params.get('height', 480)
    frames = params.get('frames', 25)
    steps = params.get('steps', 30)
    sampler_index = params.get('sampler', 0)
    sampler_shift = params.get('sampler_shift', -1)
    dynamic_shift = params.get('dynamic_shift', False)
    seed = params.get('seed', -1)
    guidance_scale = params.get('guidance_scale', 6.0)
    guidance_true = params.get('guidance_true', -1)
    init_strength = params.get('init_strength', 0.5)
    vae_type = params.get('vae_type', 'Default')
    vae_tile_frames = params.get('vae_tile_frames', 0)
    mp4_fps = params.get('fps', 24)
    mp4_interpolate = params.get('interpolate', 0)
    mp4_codec = params.get('codec', 'libx264')
    mp4_ext = params.get('format', 'mp4')
    mp4_opt = params.get('codec_options', 'crf:16')
    mp4_video = params.get('save_video', True)
    mp4_frames = params.get('save_frames', False)
    mp4_sf = params.get('save_safetensors', False)

    # Decode optional images
    init_image = helpers.decode_base64_to_image(params['init_image']) if params.get('init_image') else None
    last_image = helpers.decode_base64_to_image(params['last_image']) if params.get('last_image') else None

    # Ensure model is loaded
    for _msg in video_ui.model_load(engine, model):
        pass

    jobid = shared.state.begin('API-V2-VID', api=True)
    try:
        result = video_run.generate(
            '', '',  # task_id, ui_state
            engine, model,
            prompt, negative, [],  # styles
            width, height, frames,
            steps, sampler_index, sampler_shift, dynamic_shift,
            seed, guidance_scale, guidance_true,
            init_image, init_strength, last_image,
            vae_type, vae_tile_frames,
            mp4_fps, mp4_interpolate, mp4_codec, mp4_ext, mp4_opt, mp4_video, mp4_frames, mp4_sf,
            False, '', '',  # vlm_enhance, vlm_model, vlm_system_prompt
            {},  # override_settings
        )
    finally:
        shared.state.end(jobid)

    # result = (images, video_file, gen_info_js, info, html_log)
    video_file = result[1] if result and len(result) > 1 else None

    image_refs = []
    # Video file as first "image" ref
    if video_file and os.path.isfile(str(video_file)):
        path = str(video_file)
        ext = os.path.splitext(path)[1].lstrip('.').lower()
        image_refs.append({
            'index': 0,
            'path': path,
            'url': f'/sdapi/v2/jobs/{job_id}/images/0',
            'width': width,
            'height': height,
            'format': ext or 'mp4',
            'size': os.path.getsize(path),
        })
        thumb_path = os.path.splitext(path)[0] + '.thumb.jpg'
        if os.path.isfile(thumb_path):
            image_refs.append({'index': 1, 'path': thumb_path, 'url': f'/sdapi/v2/jobs/{job_id}/images/1', 'width': 0, 'height': 0, 'format': 'jpg', 'size': os.path.getsize(thumb_path)})

    return {'images': image_refs, 'info': {}, 'params': {k: v for k, v in params.items() if k not in ('type', 'init_image', 'last_image')}}


def execute_framepack(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.framepack import framepack_wrappers

    init_image = helpers.decode_base64_to_image(params['init_image']) if params.get('init_image') else None
    end_image = helpers.decode_base64_to_image(params['end_image']) if params.get('end_image') else None

    prompt = params.get('prompt', '')
    negative = params.get('negative', '')
    styles = params.get('styles', [])
    seed = params.get('seed', -1)
    resolution = params.get('resolution', 640)
    duration = params.get('duration', 4)
    variant = params.get('variant', 'bi-directional')
    attention = params.get('attention', 'Default')

    jobid = shared.state.begin('API-V2-FP', api=True)
    try:
        gen = framepack_wrappers.run_framepack(
            '', '',  # task_id, ui_state
            init_image, end_image,
            params.get('start_weight', 1.0), params.get('end_weight', 1.0), params.get('vision_weight', 1.0),
            prompt, params.get('system_prompt', ''), params.get('optimized_prompt', True), params.get('section_prompt', ''),
            negative, styles,
            seed, resolution, duration,
            params.get('latent_ws', 9), params.get('steps', 25),
            params.get('cfg_scale', 1.0), params.get('cfg_distilled', 10.0), params.get('cfg_rescale', 0.0),
            params.get('shift', 3.0),
            params.get('use_teacache', True), params.get('use_cfgzero', False), params.get('use_preview', True),
            params.get('fps', 30), params.get('codec', 'libx264'), params.get('save_safetensors', False),
            params.get('save_video', True), params.get('save_frames', False),
            params.get('codec_options', 'crf:16'), params.get('format', 'mp4'),
            params.get('interpolate', 0),
            attention, params.get('vae_type', 'Full'), variant,
            params.get('vlm_enhance', False), params.get('vlm_model', ''), params.get('vlm_system_prompt', ''),
        )
        video_file = None
        for item in gen:
            if item and len(item) > 0 and isinstance(item[0], str) and item[0] and not item[0].startswith('<'):
                video_file = item[0]
    finally:
        shared.state.end(jobid)

    image_refs = []
    if video_file and os.path.isfile(str(video_file)):
        path = str(video_file)
        ext = os.path.splitext(path)[1].lstrip('.').lower()
        image_refs.append({
            'index': 0,
            'path': path,
            'url': f'/sdapi/v2/jobs/{job_id}/images/0',
            'width': resolution,
            'height': resolution,
            'format': ext or 'mp4',
            'size': os.path.getsize(path),
        })
        thumb_path = os.path.splitext(path)[0] + '.thumb.jpg'
        if os.path.isfile(thumb_path):
            image_refs.append({'index': 1, 'path': thumb_path, 'url': f'/sdapi/v2/jobs/{job_id}/images/1', 'width': 0, 'height': 0, 'format': 'jpg', 'size': os.path.getsize(thumb_path)})

    return {'images': image_refs, 'info': {}, 'params': {k: v for k, v in params.items() if k not in ('type', 'init_image', 'end_image')}}


def execute_ltx(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers
    from modules.ltx import ltx_process

    model = params.get('model', '')
    prompt = params.get('prompt', '')
    negative = params.get('negative', '')
    styles = params.get('styles', [])
    width = params.get('width', 768)
    height = params.get('height', 512)
    frames = params.get('frames', 97)
    steps = params.get('steps', 50)
    sampler_index = params.get('sampler', 0)
    seed = params.get('seed', -1)

    condition_image = helpers.decode_base64_to_image(params['condition_image']) if params.get('condition_image') else None
    condition_last = helpers.decode_base64_to_image(params['condition_last']) if params.get('condition_last') else None

    jobid = shared.state.begin('API-V2-LTX', api=True)
    try:
        gen = ltx_process.run_ltx(
            '', '',  # task_id, ui_state
            model, prompt, negative, styles,
            width, height, frames, steps, sampler_index, seed,
            params.get('upsample_enable', False), params.get('upsample_ratio', 2.0),
            params.get('refine_enable', False), params.get('refine_strength', 0.4),
            params.get('condition_strength', 0.8),
            condition_image, condition_last,
            None, None,  # condition_files, condition_video
            params.get('condition_video_frames', 0), params.get('condition_video_skip', 0),
            params.get('decode_timestep', 0.05), params.get('image_cond_noise_scale', 0.025),
            params.get('fps', 24), params.get('interpolate', 0),
            params.get('codec', 'libx264'), params.get('format', 'mp4'),
            params.get('codec_options', 'crf:16'),
            params.get('save_video', True), params.get('save_frames', False), params.get('save_safetensors', False),
            params.get('audio_enable', False),
            {},  # overrides
        )
        video_file = None
        for item in gen:
            if item and len(item) > 0 and isinstance(item[0], str) and item[0]:
                video_file = item[0]
    finally:
        shared.state.end(jobid)

    image_refs = []
    if video_file and os.path.isfile(str(video_file)):
        path = str(video_file)
        ext = os.path.splitext(path)[1].lstrip('.').lower()
        image_refs.append({
            'index': 0,
            'path': path,
            'url': f'/sdapi/v2/jobs/{job_id}/images/0',
            'width': width,
            'height': height,
            'format': ext or 'mp4',
            'size': os.path.getsize(path),
        })
        thumb_path = os.path.splitext(path)[0] + '.thumb.jpg'
        if os.path.isfile(thumb_path):
            image_refs.append({'index': 1, 'path': thumb_path, 'url': f'/sdapi/v2/jobs/{job_id}/images/1', 'width': 0, 'height': 0, 'format': 'jpg', 'size': os.path.getsize(thumb_path)})

    return {'images': image_refs, 'info': {}, 'params': {k: v for k, v in params.items() if k not in ('type', 'condition_image', 'condition_last')}}


def execute_xyz_grid_dispatch(params: dict, job_id: str) -> dict:
    from enso_api.xyz_grid import execute_xyz_grid
    return execute_xyz_grid(params, job_id)


def execute_model_load(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Load or reload a checkpoint as a V2 job.

    SD.Next's reload_model_weights() manages its own shared.state.begin/end
    internally, so we don't wrap it in another state block - the job queue's
    progress poller picks up the state that reload_model_weights sets.

    Note: model loading is not cancellable - reload_model_weights does not
    check shared.state.interrupted. Cancellation will only take effect
    before execution starts (while queued) or after it completes.
    """
    from modules import shared, sd_models, devices, modelloader

    checkpoint = params.get('sd_model_checkpoint')
    force = params.get('force', False)
    dtype = params.get('dtype')

    if force:
        sd_models.unload_model_weights(op='model')
    if dtype is not None:
        shared.opts.cuda_dtype = dtype
        devices.set_dtype()
    if checkpoint:
        ref_opts = modelloader.get_reference_opts(checkpoint, quiet=True)
        if ref_opts:
            if '@' not in checkpoint:
                loaded = modelloader.load_reference(checkpoint)
                if not loaded:
                    raise RuntimeError(f'Failed to load reference model: {checkpoint}')
            else:
                model, url = checkpoint.split('@', 1)
                loaded = modelloader.load_civitai(model, url)
                if loaded is not None:
                    checkpoint = loaded
                else:
                    raise RuntimeError(f'Failed to load CivitAI model: {checkpoint}')
        shared.opts.sd_model_checkpoint = checkpoint
    sd_models.reload_model_weights()

    # Build checkpoint info for the result
    info = {'loaded': shared.sd_loaded and shared.sd_model is not None}
    if shared.sd_loaded and shared.sd_model is not None:
        info['type'] = shared.sd_model_type
        info['class_name'] = shared.sd_model.__class__.__name__
        if hasattr(shared.sd_model, 'sd_model_checkpoint'):
            info['checkpoint'] = shared.sd_model.sd_model_checkpoint
        if hasattr(shared.sd_model, 'sd_checkpoint_info'):
            ci = shared.sd_model.sd_checkpoint_info
            info['title'] = ci.title
            info['name'] = ci.name
            info['filename'] = ci.filename
            info['hash'] = ci.shorthash

    return {'images': [], 'info': info, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_model_merge(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Merge two or three checkpoint models as a V2 job.

    SD.Next's run_modelmerger() manages its own shared.state.begin/end
    internally, so we don't wrap it in another state block.
    """
    from modules import extras, sd_models

    merge_params = {k: v for k, v in params.items() if k != 'type' and v not in [None, "None", "", 0, []]}
    if not merge_params.get('custom_name'):
        raise ValueError('Merge requires an output model name')
    if not merge_params.get('primary_model_name') or not merge_params.get('secondary_model_name'):
        raise ValueError('Merge requires primary and secondary models')

    results = extras.run_modelmerger(None, **merge_params)
    status = results[-1] if isinstance(results, list) else str(results)
    sd_models.list_models()

    return {'images': [], 'info': {'status': status}, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_model_replace(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Replace model components and save as a new model as a V2 job.

    SD.Next's run_model_modules() is a generator that manages its own
    shared.state.begin/end internally. The generator must be iterated
    to completion so state.end is reached.
    """
    from modules import extras

    status = 'Unknown'
    for msg in extras.run_model_modules(
        params.get('model_type', ''),
        params.get('model_name', ''),
        params.get('custom_name', ''),
        params.get('comp_unet', ''),
        params.get('comp_vae', ''),
        params.get('comp_te1', ''),
        params.get('comp_te2', ''),
        params.get('precision', 'fp16'),
        params.get('comp_scheduler', ''),
        params.get('comp_prediction', ''),
        params.get('comp_lora', ''),
        params.get('comp_fuse', 0.0),
        params.get('meta_author', ''),
        params.get('meta_version', ''),
        params.get('meta_license', ''),
        params.get('meta_desc', ''),
        params.get('meta_hint', ''),
        None,  # meta_thumbnail - not applicable via API
        params.get('create_diffusers', True),
        params.get('create_safetensors', False),
        params.get('debug', False),
    ):
        status = msg

    return {'images': [], 'info': {'status': status}, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_model_save(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Save the currently loaded model to disk as a V2 job.

    sd_models.save_model() does not manage shared.state, so we wrap
    the call in state.begin/end for progress visibility.
    """
    from modules import shared, sd_models

    name = params.get('name', '')
    if not name:
        raise ValueError('Save requires a model name')

    jobid = shared.state.begin('Save', api=True)
    try:
        result = sd_models.save_model(
            name=name,
            path=params.get('path'),
            shard=params.get('shard'),
            overwrite=params.get('overwrite', False),
        )
    finally:
        shared.state.end(jobid)

    if result and any(result.startswith(e) for e in ['Invalid', 'Model not', 'Path exists', 'Error']):
        raise RuntimeError(result)

    return {'images': [], 'info': {'status': result}, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_loader_load(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Load a model with custom component configuration as a V2 job.

    ui_models_load.load_model() does not manage shared.state, so we wrap
    the call in state.begin/end. Delegates to models_ops.post_loader_load()
    to reuse the component setup logic.
    """
    from modules import shared
    from enso_api.models_ops import post_loader_load

    model_type = params.get('model_type', '')
    repo = params.get('repo', '')
    if not model_type or not repo:
        raise ValueError('Loader requires model_type and repo')

    jobid = shared.state.begin('Load', api=True)
    try:
        result = post_loader_load(model_type, repo, params.get('components'))
    finally:
        shared.state.end(jobid)

    return {'images': [], 'info': result, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_lora_extract(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Extract a LoRA from the currently loaded model as a V2 job.

    lora_extract.make_lora() is a generator that manages its own
    shared.state.begin/end internally. The generator must be iterated
    to completion so state.end is reached.
    """
    from modules.lora import lora_extract

    filename = params.get('filename', '')
    if not filename:
        raise ValueError('LoRA extract requires a filename')

    status = 'Unknown'
    for msg in lora_extract.make_lora(
        filename,
        params.get('max_rank', 64),
        params.get('auto_rank', False),
        params.get('rank_ratio', 0.5),
        params.get('modules', ['te', 'unet']),
        params.get('overwrite', False),
    ):
        status = msg

    return {'images': [], 'info': {'status': status}, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_hf_download(params: dict, job_id: str) -> dict:  # pylint: disable=unused-argument
    """Download a model from HuggingFace Hub as a V2 job.

    models_hf.hf_download_model() delegates to download_diffusers_model()
    which manages its own shared.state.begin/end internally.
    """
    from modules import models_hf

    hub_id = params.get('hub_id', '')
    if not hub_id:
        raise ValueError('HF download requires a hub_id')

    result = models_hf.hf_download_model(
        hub_id,
        params.get('token', ''),
        params.get('variant', ''),
        params.get('revision', ''),
        params.get('mirror', ''),
        params.get('custom_pipeline', ''),
    )

    return {'images': [], 'info': {'status': result}, 'params': {k: v for k, v in params.items() if k != 'type'}}


def execute_rembg(params: dict, job_id: str) -> dict:
    from modules import shared
    from modules.api import helpers

    image = helpers.decode_base64_to_image(params.get('image', ''))
    model = params.get('model', 'ben2')
    return_mask = params.get('return_mask', False)
    refine = params.get('refine', False)

    jobid = shared.state.begin('API-V2-REMBG', api=True)
    try:
        if model == 'ben2':
            from modules.rembg import ben2
            result_image = ben2.remove(image, refine=refine)
        else:
            from installer import install
            for pkg in ['dctorch==0.1.2', 'pymatting', 'pooch', 'rembg']:
                install(pkg, no_deps=True, ignore=False)
            import rembg
            result_image = rembg.remove(
                image,
                session=rembg.new_session(model),
                only_mask=return_mask,
                alpha_matting=params.get('alpha_matting', False),
                alpha_matting_foreground_threshold=params.get('alpha_matting_foreground_threshold', 240),
                alpha_matting_background_threshold=params.get('alpha_matting_background_threshold', 10),
                alpha_matting_erode_size=params.get('alpha_matting_erode_size', 10),
            )
        from modules import images as img_module
        output_dir = shared.opts.outdir_extras_samples if hasattr(shared.opts, 'outdir_extras_samples') else shared.opts.outdir_txt2img_samples
        path_info = img_module.save_image(result_image, output_dir, "", prompt=f"rembg-{model}")
    finally:
        shared.state.end(jobid)

    image_refs = []
    if path_info:
        fpath = path_info[0] if isinstance(path_info, (list, tuple)) else str(path_info)
        if os.path.isfile(str(fpath)):
            ext = os.path.splitext(str(fpath))[1].lstrip('.').lower()
            image_refs.append({'index': 0, 'path': str(fpath), 'url': f'/sdapi/v2/jobs/{job_id}/images/0', 'width': result_image.width, 'height': result_image.height, 'format': ext or 'png', 'size': os.path.getsize(str(fpath))})

    return {'images': image_refs, 'info': {'model': model}, 'params': {k: v for k, v in params.items() if k not in ('type', 'image')}}


EXECUTORS = {
    'generate': execute_generate,
    'upscale': execute_upscale,
    'caption': execute_caption,
    'enhance': execute_enhance,
    'detect': execute_detect,
    'preprocess': execute_preprocess,
    'video': execute_video,
    'framepack': execute_framepack,
    'ltx': execute_ltx,
    'xyz-grid': execute_xyz_grid_dispatch,
    'model-load': execute_model_load,
    'model-merge': execute_model_merge,
    'model-replace': execute_model_replace,
    'model-save': execute_model_save,
    'loader-load': execute_loader_load,
    'lora-extract': execute_lora_extract,
    'hf-download': execute_hf_download,
    'rembg': execute_rembg,
}
