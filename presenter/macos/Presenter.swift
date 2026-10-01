import AppKit
import ScreenCaptureKit
import CoreMedia
import CoreImage
import Carbon.HIToolbox
import Vision
import AVFoundation

// 창을 화면에서 확실히 내린다. orderOut 만으로는 남는 경우가 있었다(디스플레이 구성이
// 바뀐 뒤 등 — 녹화가 끝났는데 카메라 창만 남는 증상). close() 까지 불러 쐐기를 박는다.
// 우리 창은 모두 isReleasedWhenClosed=false 라 객체는 살아 있다(여기서 한 번 더 확인한다).
extension NSWindow {
    func vanish() {
        orderOut(nil)
        if isReleasedWhenClosed { isReleasedWhenClosed=false }
        close()
    }
}

// MARK: 단축키
// 사이드바가 "focus=ctrl+alt+F;snip=ctrl+alt+S;…" 꼴로 보낸다. 맥과 윈도우는 운영체제가
// 미리 가져간 조합이 서로 달라, 사이드바가 이 컴퓨터용 한 벌만 골라 보낸다. 받은 글은
// UserDefaults 에 남긴다. 앱만 따로 켰을 때도 지난번에 정한 조합이 그대로 들어야 한다.
struct Combo: Equatable {
    var mods: UInt32          // controlKey|optionKey|shiftKey|cmdKey
    var code: UInt32          // kVK_ANSI_…
    var label: String         // "⌃⌥F"
    var key: String = ""      // "F"
    // 사이드바의 hotNorm 과 한 글자도 다르지 않아야 한다(ctrl+alt+shift+cmd 순서, 글자는 대문자).
    var text: String {
        var parts: [String]=[]
        if mods & UInt32(controlKey) != 0 { parts.append("ctrl") }
        if mods & UInt32(optionKey) != 0 { parts.append("alt") }
        if mods & UInt32(shiftKey) != 0 { parts.append("shift") }
        if mods & UInt32(cmdKey) != 0 { parts.append("cmd") }
        return (parts+[key]).joined(separator:"+")
    }
    // 이벤트 탭이 보는 값. 다른 수정 키가 함께 눌린 것은 다른 조합이므로 정확히 견준다.
    var flags: CGEventFlags {
        var mask=CGEventFlags()
        if mods & UInt32(controlKey) != 0 { mask.insert(.maskControl) }
        if mods & UInt32(optionKey) != 0 { mask.insert(.maskAlternate) }
        if mods & UInt32(shiftKey) != 0 { mask.insert(.maskShift) }
        if mods & UInt32(cmdKey) != 0 { mask.insert(.maskCommand) }
        return mask
    }
    func matches(_ event: CGEvent) -> Bool {
        let care: CGEventFlags=[.maskControl,.maskAlternate,.maskShift,.maskCommand]
        return event.flags.intersection(care)==flags
            && UInt32(event.getIntegerValueField(.keyboardEventKeycode))==code
    }
}
enum Keys {
    static let order=["present","focus","snip","clip","clear","unlock"]
    static let fallback=["present":"ctrl+alt+P","focus":"ctrl+alt+F","snip":"ctrl+alt+S",
                         "clip":"ctrl+alt+V","clear":"ctrl+alt+D","unlock":"ctrl+alt+T"]
    // 글자와 숫자만 받는다. F1~F12 는 밝기·미션 컨트롤·VoiceOver 가 이미 쓰고 있다.
    static let codes: [String:Int]=["A":kVK_ANSI_A,"B":kVK_ANSI_B,"C":kVK_ANSI_C,"D":kVK_ANSI_D,"E":kVK_ANSI_E,"F":kVK_ANSI_F,"G":kVK_ANSI_G,"H":kVK_ANSI_H,"I":kVK_ANSI_I,"J":kVK_ANSI_J,"K":kVK_ANSI_K,"L":kVK_ANSI_L,"M":kVK_ANSI_M,"N":kVK_ANSI_N,"O":kVK_ANSI_O,"P":kVK_ANSI_P,"Q":kVK_ANSI_Q,"R":kVK_ANSI_R,"S":kVK_ANSI_S,"T":kVK_ANSI_T,"U":kVK_ANSI_U,"V":kVK_ANSI_V,"W":kVK_ANSI_W,"X":kVK_ANSI_X,"Y":kVK_ANSI_Y,"Z":kVK_ANSI_Z, "0":kVK_ANSI_0,"1":kVK_ANSI_1,"2":kVK_ANSI_2,"3":kVK_ANSI_3,"4":kVK_ANSI_4,"5":kVK_ANSI_5,"6":kVK_ANSI_6,"7":kVK_ANSI_7,"8":kVK_ANSI_8,"9":kVK_ANSI_9,]
    static func parse(_ text: String) -> Combo? {
        var mods: UInt32=0, main=""
        for piece in text.split(separator:"+") {
            let part=piece.trimmingCharacters(in:.whitespaces).lowercased()
            if part.isEmpty { continue }
            switch part {
            case "ctrl","control": mods |= UInt32(controlKey)
            case "alt","option","opt": mods |= UInt32(optionKey)
            case "shift": mods |= UInt32(shiftKey)
            case "cmd","meta","win": mods |= UInt32(cmdKey)
            default:
                if !main.isEmpty { return nil }
                main=part.uppercased()
            }
        }
        guard let code=codes[main] else { return nil }
        var signs=""
        if mods & UInt32(controlKey) != 0 { signs += "⌃" }
        if mods & UInt32(optionKey) != 0 { signs += "⌥" }
        if mods & UInt32(shiftKey) != 0 { signs += "⇧" }
        if mods & UInt32(cmdKey) != 0 { signs += "⌘" }
        return Combo(mods:mods,code:UInt32(code),label:signs+main,key:main)
    }
    // 앱이 지금 실제로 듣고 있는 조합. 사이드바가 이것을 보고 어긋나면 다시 보낸다.
    static func text(_ set: [String:Combo]) -> String {
        order.map{ $0+"="+(set[$0]?.text ?? "") }.joined(separator:";")
    }
    // 못 읽은 것은 기본 조합으로 되돌린다. 단축키가 하나도 없는 상태로 남지 않게 한다.
    static func read(_ text: String) -> [String:Combo] {
        var given: [String:String]=[:]
        for entry in text.split(separator:";") {
            let pair=entry.split(separator:"=",maxSplits:1)
            if pair.count==2 { given[pair[0].trimmingCharacters(in:.whitespaces)]=String(pair[1]) }
        }
        var out: [String:Combo]=[:]
        for name in order { out[name]=parse(given[name] ?? "") ?? parse(fallback[name]!)! }
        return out
    }
}

// Every frame comes from ScreenCaptureKit. No screenshots are saved or sent.
final class LiveView: NSView {
    // 화면에 실제로 그려질 부분만 들고 있는다. pieceRect 는 그 조각이 덮는 화면 영역(포인트).
    var piece: NSImage?
    var pieceRect = NSRect.zero
    var scale: CGFloat = 1
    var pointer = CGPoint.zero
    var pointerSize: CGFloat = 44
    // The overlay is placed on screen before capture starts so ScreenCaptureKit can list and exclude it.
    // Nothing is drawn until the stream is live, otherwise the arrow would flash in the corner.
    var ready = false
    var focus = false
    var focusRadius: CGFloat = 170
    var dim: CGFloat = 0.45
    var ringColor = NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1)
    var blurImage: NSImage?
    // 발표 중 화면 왼쪽 아래 안내에 쓴다. 사용자가 바꾼 조합을 그대로 보여 준다.
    var focusLabel="⌃⌥F"
    override var isOpaque: Bool { false }
    override func draw(_ dirtyRect: NSRect) {
        NSColor.clear.setFill(); bounds.fill(using: .copy)
        guard ready else { return }
        // At 1× this crop is the whole screen, so the same rectangle drives both zoom and focus mode.
        let crop = NSRect(x:pointer.x*(1-1/scale), y:pointer.y*(1-1/scale), width:bounds.width/scale,height:bounds.height/scale)
        let hints: [NSImageRep.HintKey:Any] = [.interpolation:NSImageInterpolation.high]
        // 조각이 덮는 화면 영역을 지금 배율·위치에 맞는 자리로 옮긴다.
        func place(_ source: NSRect) -> NSRect {
            NSRect(x:(source.minX-crop.minX)*scale,y:(source.minY-crop.minY)*scale,
                   width:source.width*scale,height:source.height*scale)
        }
        if focus, let blur = blurImage {
            blur.draw(in:bounds,from:crop,operation:.copy,fraction:1,respectFlipped:true,hints:hints)
            let circle = NSBezierPath(ovalIn:NSRect(x:pointer.x-focusRadius,y:pointer.y-focusRadius,width:focusRadius*2,height:focusRadius*2))
            if dim > 0 {
                let outside = NSBezierPath(rect:bounds)
                outside.append(circle)
                outside.windingRule = .evenOdd
                NSColor.black.withAlphaComponent(min(0.9,max(0,dim))).setFill()
                outside.fill()
            }
            if let sharp = piece {
                NSGraphicsContext.saveGraphicsState()
                circle.addClip()
                sharp.draw(in:place(pieceRect),from:.zero,operation:.copy,fraction:1,respectFlipped:true,hints:hints)
                NSGraphicsContext.restoreGraphicsState()
            }
            ringColor.withAlphaComponent(0.85).setStroke();circle.lineWidth=3;circle.stroke()
        } else if scale > 1, let sharp = piece {
            sharp.draw(in:place(pieceRect),from:.zero,operation:.copy,fraction:1,respectFlipped:true,hints:hints)
        }
        // The system cursor stays visible; drawing a second arrow is what looked doubled.
        // 집중 모드에서는 큰 원이 이미 포인터 자리를 가리킨다. 포인터 원까지 그리면 두 겹이라 지저분하다.
        if !focus {
            let p=pointer, r=pointerSize
            let ring=NSBezierPath(ovalIn:NSRect(x:p.x-r,y:p.y-r,width:r*2,height:r*2))
            ringColor.withAlphaComponent(0.20).setFill();ring.fill()
            ringColor.withAlphaComponent(0.95).setStroke();ring.lineWidth=6;ring.stroke()
            let edge=NSBezierPath(ovalIn:NSRect(x:p.x-r-3,y:p.y-r-3,width:(r+3)*2,height:(r+3)*2))
            NSColor(calibratedRed:0.06,green:0.20,blue:0.16,alpha:0.55).setStroke();edge.lineWidth=2;edge.stroke()
        }
        let state=String(format:"%.1f×",Double(scale))+(focus ? " · 집중 모드" : "")
        let keys=(scale > 1 || focus) ? "Esc 원래대로" : "Esc 발표 종료"
        let hud=" \(state)   ⌃⌥휠 확대 · ⌃⌥⇧휠 원 크기 · \(focusLabel) 집중 모드 · \(keys) "
        hud.draw(at:NSPoint(x:24,y:24),withAttributes:[.font:NSFont.boldSystemFont(ofSize:15),.foregroundColor:NSColor.white,.backgroundColor:NSColor.black.withAlphaComponent(0.78)])
    }
}
// MARK: 녹화 표시기
// 녹화 중임을 알리는 작은 창. sharingType = .none 이라 **화면 녹화·화면 공유에 담기지 않는다**
// (암호 관리자들이 창을 가릴 때 쓰는 것과 같은 방법). 끌어서 옮길 수 있고, 둔 자리를 기억한다.
final class BadgeSkin: NSView {
    override func draw(_ dirty: NSRect) {
        let box=NSBezierPath(roundedRect:bounds,xRadius:bounds.height/2,yRadius:bounds.height/2)
        NSColor(calibratedRed:0.06,green:0.16,blue:0.13,alpha:0.94).setFill();box.fill()
        NSColor(calibratedWhite:1,alpha:0.16).setStroke();box.lineWidth=1;box.stroke()
    }
}
final class BadgePanel: NSPanel {
    private let dot=NSView(frame:NSRect(x:0,y:0,width:11,height:11))
    private let clock=NSTextField(labelWithString:"00:00")
    private let note=NSTextField(labelWithString:"녹화 중")
    private let pause=NSButton(), stop=NSButton(), cancel=NSButton()
    var onButton:((String)->Void)?
    private var blink: Timer?
    static let spotKey="badgeSpot"
    init() {
        super.init(contentRect:NSRect(x:0,y:0,width:268,height:46),
                   styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        isFloatingPanel=true
        level = .statusBar
        sharingType = .none                       // 화면 녹화에 잡히지 않게 한다
        backgroundColor = .clear
        isOpaque=false
        hasShadow=true
        isMovableByWindowBackground=true        // 배경을 끌어 옮긴다
        hidesOnDeactivate=false
        isReleasedWhenClosed=false
        collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.ignoresCycle]
        let skin=BadgeSkin(frame:NSRect(x:0,y:0,width:268,height:46))
        skin.wantsLayer=true
        contentView=skin
        dot.wantsLayer=true
        dot.layer?.backgroundColor=NSColor(calibratedRed:1,green:0.35,blue:0.29,alpha:1).cgColor
        dot.layer?.cornerRadius=5.5
        dot.frame=NSRect(x:14,y:17.5,width:11,height:11)
        skin.addSubview(dot)
        clock.font=NSFont.monospacedDigitSystemFont(ofSize:15,weight:.bold)
        clock.textColor = .white
        clock.frame=NSRect(x:32,y:14,width:62,height:19)
        skin.addSubview(clock)
        note.font=NSFont.systemFont(ofSize:10)
        note.textColor=NSColor(calibratedWhite:1,alpha:0.62)
        note.frame=NSRect(x:32,y:2,width:100,height:13)
        skin.addSubview(note)
        for (index,(button,title,which)) in [(pause,"❙❙","pause"),(stop,"■","stop"),(cancel,"✕","cancel")].enumerated() {
            button.title=title
            button.isBordered=false
            button.font=NSFont.systemFont(ofSize:13,weight:.bold)
            button.contentTintColor = which=="stop" ? NSColor(calibratedRed:1,green:0.45,blue:0.38,alpha:1) : .white
            button.setButtonType(.momentaryChange)
            button.frame=NSRect(x:134+CGFloat(index)*44,y:9,width:40,height:28)
            button.target=self
            button.action=#selector(tap(_:))
            button.identifier=NSUserInterfaceItemIdentifier(which)
            button.toolTip=["pause":"일시 정지 · 다시 녹화","stop":"멈추고 저장","cancel":"녹화 버리기"][which]
            skin.addSubview(button)
        }
        blink=Timer.scheduledTimer(withTimeInterval:0.7,repeats:true){ [weak self] _ in
            guard let self=self else { return }
            self.dot.alphaValue = self.dot.alphaValue > 0.5 ? 0.25 : 1
        }
        if let blink=blink { RunLoop.main.add(blink,forMode:.common) }
    }
    @objc private func tap(_ sender: NSButton) { onButton?(sender.identifier?.rawValue ?? "") }
    func update(time: String, paused: Bool, camera: Bool) {
        clock.stringValue=time
        note.stringValue = (paused ? "잠시 멈춤" : "녹화 중") + (camera ? " · 카메라" : "")
        pause.title = paused ? "▶" : "❙❙"
        dot.layer?.backgroundColor = (paused ? NSColor(calibratedRed:0.96,green:0.65,blue:0.14,alpha:1)
                                             : NSColor(calibratedRed:1,green:0.35,blue:0.29,alpha:1)).cgColor
        if paused { dot.alphaValue=1 }
    }
    // 지난번에 둔 자리에 띄운다. 처음이면 오른쪽 아래.
    func place(on wanted: NSScreen?=nil) {
        guard let screen=wanted ?? screenInUse() else { return }
        let saved=UserDefaults.standard.string(forKey:BadgePanel.spotKey) ?? ""
        let parts=saved.split(separator:",").compactMap{Double($0)}
        var origin=NSPoint(x:screen.visibleFrame.maxX-frame.width-28,y:screen.visibleFrame.minY+28)
        // 지난번 자리는 '지금 쓰는 그 화면 안' 일 때만 쓴다(다른 모니터를 녹화하면 그쪽에 띄운다).
        if parts.count==2 {
            let wanted=NSPoint(x:parts[0],y:parts[1])
            if screen.visibleFrame.contains(NSPoint(x:wanted.x+20,y:wanted.y+20)) { origin=wanted }
        }
        setFrameOrigin(origin)
    }
    func remember() { UserDefaults.standard.set("\(frame.origin.x),\(frame.origin.y)",forKey:BadgePanel.spotKey) }
    override func mouseUp(with event: NSEvent) { super.mouseUp(with:event); remember() }
    func dismiss() { blink?.invalidate(); blink=nil; vanish() }
    override var canBecomeKey: Bool { false }
}

// 지금 쓰고 있는 모니터. 표시기와 카메라 창을 여기에 띄운다(예전에는 늘 '주 모니터' 였다).
func screenInUse() -> NSScreen? {
    NSScreen.screens.first(where:{ $0.frame.contains(NSEvent.mouseLocation) }) ?? NSScreen.main
}
// 확장이 알려 준 '지금 녹화 중인 화면' 을 NSScreen 으로 바꾼다.
// 받는 글: "<크롬이 부르는 이름>|<가로>x<세로>(픽셀)" 예) "screen:3:0|2560x1440"
// ① 이름 안의 숫자가 디스플레이 번호와 맞으면 그 화면.
// ② 아니면 픽셀 크기가 같은 화면. 같은 크기가 여럿이면(똑같은 모니터 두 대 같은 경우)
//    그중 마우스가 있는 쪽을 고른다 — 방금 고르기 창에서 누른 그 화면일 가능성이 높다.
// ③ 아무것도 못 고르면 nil. 그때는 마우스가 있는 화면에 띄운다.
func screenForCapture(_ text: String) -> NSScreen? {
    guard !text.isEmpty else { return nil }
    let parts=text.split(separator:"|",maxSplits:1,omittingEmptySubsequences:false)
    let name=String(parts.first ?? "")
    for piece in name.split(separator:":") {
        guard let number=UInt32(piece), number > 0 else { continue }
        if let found=NSScreen.screens.first(where:{
            ($0.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value == number
        }) { return found }
    }
    guard parts.count>1 else { return nil }
    let size=parts[1].split(separator:"x").compactMap{ Double($0) }
    guard size.count==2, size[0]>0 else { return nil }
    let fitting=NSScreen.screens.filter{
        let wide=$0.frame.width*$0.backingScaleFactor, tall=$0.frame.height*$0.backingScaleFactor
        return abs(wide-size[0])<4 && abs(tall-size[1])<4
    }
    if fitting.count == 1 { return fitting[0] }
    let here=NSEvent.mouseLocation
    return fitting.first(where:{ $0.frame.contains(here) }) ?? fitting.first
}

// MARK: 녹화 중 동그란 카메라 창
// 표시기와 반대로 이 창은 화면 녹화에 **담겨야** 한다(sharingType 을 건드리지 않는다).
// 테두리만 있는 동그란 창이라 제목 표시줄이 없다 — 브라우저 창으로는 만들 수 없어 앱이 그린다.
final class CameraPanel: NSPanel {
    static let spotKey="cameraSpot"
    private let session=AVCaptureSession()
    private var preview: AVCaptureVideoPreviewLayer?
    private let side: CGFloat
    init(side: CGFloat) {
        self.side=side
        super.init(contentRect:NSRect(x:0,y:0,width:side,height:side),
                   styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        isFloatingPanel=true
        level = .statusBar
        backgroundColor = .clear
        isOpaque=false
        hasShadow=true
        isMovableByWindowBackground=true
        hidesOnDeactivate=false
        isReleasedWhenClosed=false
        collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.ignoresCycle]
        let box=NSView(frame:NSRect(x:0,y:0,width:side,height:side))
        box.wantsLayer=true
        box.layer?.backgroundColor=NSColor.black.cgColor
        box.layer?.cornerRadius=side/2
        box.layer?.masksToBounds=true
        box.layer?.borderWidth=4
        box.layer?.borderColor=NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1).cgColor
        contentView=box
    }
    override var canBecomeKey: Bool { false }
    // 이름이 맞는 카메라를 고른다(사이드바에서 고른 그 카메라). 없으면 기본 카메라.
    private static func device(_ name: String) -> AVCaptureDevice? {
        var types:[AVCaptureDevice.DeviceType]=[.builtInWideAngleCamera]
        // 바깥 카메라(USB 웹캠)는 macOS 14 부터 이 이름으로 찾는다. 그 아래에서는 기본 카메라로 간다.
        if #available(macOS 14.0,*) { types.append(.external) }
        let all=AVCaptureDevice.DiscoverySession(deviceTypes:types,mediaType:.video,position:.unspecified).devices
        let wanted=name.trimmingCharacters(in:.whitespaces)
        if !wanted.isEmpty, let found=all.first(where:{ $0.localizedName==wanted || wanted.contains($0.localizedName) }) { return found }
        return all.first ?? AVCaptureDevice.default(for:.video)
    }
    // 권한이 아직 없으면 물어만 보고 이번 녹화에는 띄우지 않는다. 그래야 확장이 '앱이 못 띄웠다'
    // 로 보고 영상 안에 동그라미를 합쳐 넣는다 — 둘 다 뜨는 일이 없다.
    func begin(name: String) -> Bool {
        switch AVCaptureDevice.authorizationStatus(for:.video) {
        case .authorized: break
        case .notDetermined:
            AVCaptureDevice.requestAccess(for:.video){ _ in }
            return false
        default: return false
        }
        guard let device=CameraPanel.device(name), let input=try? AVCaptureDeviceInput(device:device) else { return false }
        session.beginConfiguration()
        session.sessionPreset = .high
        guard session.canAddInput(input) else { session.commitConfiguration(); return false }
        session.addInput(input)
        session.commitConfiguration()
        let layer=AVCaptureVideoPreviewLayer(session:session)
        layer.videoGravity = .resizeAspectFill
        layer.frame=NSRect(x:0,y:0,width:side,height:side)
        // 내 모습은 거울이 익숙하다. 좌우를 뒤집어 보여 준다.
        if let link=layer.connection, link.isVideoMirroringSupported {
            link.automaticallyAdjustsVideoMirroring=false
            link.isVideoMirrored=true
        }
        contentView?.layer?.insertSublayer(layer,at:0)
        preview=layer
        DispatchQueue.global(qos:.userInitiated).async { [weak self] in self?.session.startRunning() }
        return true
    }
    func place(on wanted: NSScreen?=nil) {
        guard let screen=wanted ?? screenInUse() else { return }
        let saved=UserDefaults.standard.string(forKey:CameraPanel.spotKey) ?? ""
        let parts=saved.split(separator:",").compactMap{Double($0)}
        var origin=NSPoint(x:screen.visibleFrame.maxX-side-28,y:screen.visibleFrame.minY+28)
        // 지난번 자리는 '지금 쓰는 그 화면 안' 일 때만 쓴다. 다른 모니터를 녹화하면 그 화면에 띄운다.
        if parts.count==2 {
            let wanted=NSPoint(x:parts[0],y:parts[1])
            if screen.visibleFrame.contains(NSPoint(x:wanted.x+20,y:wanted.y+20)) { origin=wanted }
        }
        setFrameOrigin(origin)
    }
    override func mouseUp(with event: NSEvent) {
        super.mouseUp(with:event)
        UserDefaults.standard.set("\(frame.origin.x),\(frame.origin.y)",forKey:CameraPanel.spotKey)
    }
    func dismiss() {
        if session.isRunning { session.stopRunning() }
        for input in session.inputs { session.removeInput(input) }
        preview?.removeFromSuperlayer(); preview=nil
        vanish()
    }
}

final class Presenter: NSObject, NSApplicationDelegate, SCStreamOutput, SCStreamDelegate {
    var status: NSStatusItem!
    var window: NSPanel?
    var view: LiveView?
    var stream: SCStream?
    var tap: CFMachPort?
    var tapSource: CFRunLoopSource?
    var timer: Timer?
    var scale: CGFloat=1
    var focus=false
    var blurLevel: CGFloat=10
    var focusRadius: CGFloat=170
    var focusDim: CGFloat=0.45
    var ringSize: CGFloat=44
    var ringHex="#dff39c"
    var active=false
    var starting=false
    var cursorHidden=false
    var displayID: CGDirectDisplayID=0
    var screen: NSScreen?
    // 모니터를 옮기는 중인지. 옮기는 데 잠깐 걸리므로 그 사이 또 옮기라고 하면 안 된다.
    var moving=false
    var movedAt: CFAbsoluteTime=0
    var generation=0
    let context=CIContext()
    let frameQueue=DispatchQueue(label:"sheriff.frames",qos:.userInteractive)
    var lastFrame: CFAbsoluteTime=0
    // 프레임 처리 스레드에서 뷰를 만지지 않으려고 포인터 위치를 따로 둔다.
    var pointerNow = CGPoint.zero
    // 크게 흐린 배경은 매 프레임 다시 만들 이유가 없다. 10fps 로도 눈에 띄지 않는다.
    var lastBlur: CFAbsoluteTime = 0
    var hotKeys: [EventHotKeyRef] = []
    // 사이드바에서 정한 단축키. 처음에는 기본 조합.
    var combos: [String:Combo] = Keys.read("")
    var hotKeyHandler=false
    var notice: NSPanel?
    var badge: BadgePanel?
    var camera: CameraPanel?
    // 확장이 알려 준 '지금 녹화 중인 화면'. 표시기와 카메라 창을 그 모니터에 띄운다.
    var recordDisplay=""
    // 확장에서 1초마다 소식이 온다. 한동안 조용하면 녹화 창이 사라진 것이다 — 스스로 거둔다.
    var badgeWatch: Timer?
    // 클릭 통과 핀 위에서 휠로 투명도를 바꾸기 위한 이벤트 가로채기(통과 핀이 있을 때만 건다).
    var wheelTap: CFMachPort?
    var wheelSource: CFRunLoopSource?
    var pins:[PinWindow]=[]
    var snip: SnipOverlay?
    // 모니터가 여러 대면 화면마다 한 장씩 덮는다. 어느 화면에서든 끌어 고를 수 있어야 한다.
    var snipMore:[SnipOverlay]=[]
    // 고른 조각을 핀으로 띄울지(기본), ‘캡처이미지’ 폴더에 저장하고 복사할지.
    var snipSave=false
    // 조각을 내는 동안 확대·집중 모드를 잠시 끄고, 끝나면 이 값으로 되돌린다.
    var snipRestore:(CGFloat,Bool)?
    func applicationDidFinishLaunching(_ notification: Notification) {
        status=NSStatusBar.system.statusItem(withLength:NSStatusItem.variableLength)
        if let symbol=NSImage(systemSymbolName:"plus.magnifyingglass",accessibilityDescription:"다있쌤 발표 도우미") {
            symbol.isTemplate=true;status.button?.image=symbol;status.button?.title=""
        } else { status.button?.title="다있쌤 ↗" }
        status.button?.toolTip="다있쌤 · 발표 도우미"
        let menu=NSMenu()
        for (title,selector) in [("발표 시작",#selector(startAction)),("발표 종료 · 커서 복원",#selector(stopAction)),("집중 모드 켜기 · 끄기",#selector(toggleFocus)),("사용 방법",#selector(help)),("앱 종료",#selector(quit))] {
            let item=NSMenuItem(title:title,action:selector,keyEquivalent:"");item.target=self;menu.addItem(item)
        }
        let blurMenu=NSMenu()
        for (title,level) in [("약하게",5),("보통",10),("강하게",20)] {
            let item=NSMenuItem(title:title,action:#selector(setBlur(_:)),keyEquivalent:"");item.target=self;item.tag=level;blurMenu.addItem(item)
        }
        let blurItem=NSMenuItem(title:"흐림 강도",action:nil,keyEquivalent:"");blurItem.submenu=blurMenu;menu.insertItem(blurItem,at:3)
        let helperMenu=NSMenu()
        for (title,selector) in [("등록",#selector(registerHost)),("등록 해제",#selector(unregisterHost))] {
            let item=NSMenuItem(title:title,action:selector,keyEquivalent:"");item.target=self;helperMenu.addItem(item)
        }
        let helperItem=NSMenuItem(title:"클립보드 도우미",action:nil,keyEquivalent:"");helperItem.submenu=helperMenu;menu.insertItem(helperItem,at:4)
        let pinMenu=NSMenu()
        for (title,selector) in [("화면 조각 잘라 붙이기",#selector(snipAction)),("화면 조각 저장하기 · 복사",#selector(snipSaveAction)),("클립보드 붙이기",#selector(pinClipboard)),("녹화 카메라 창 미리 보기",#selector(previewCamera)),("클릭 통과 켜기 · 끄기",#selector(throughPins)),("클릭 통과 모두 해제",#selector(unlockPins)),("핀 모두 닫기",#selector(clearPinsAction))] {
            let item=NSMenuItem(title:title,action:selector,keyEquivalent:"");item.target=self;pinMenu.addItem(item)
        }
        let pinItem=NSMenuItem(title:"화면 조각 핀",action:nil,keyEquivalent:"");pinItem.submenu=pinMenu;menu.insertItem(pinItem,at:3)
        status.menu=menu
        DistributedNotificationCenter.default().addObserver(self,selector:#selector(remoteCommand(_:)),
            name:Notification.Name("app.browsersheriff.presenter.command"),object:nil)
        DistributedNotificationCenter.default().addObserver(self,selector:#selector(recorderCommand(_:)),
            name:Notification.Name("app.browsersheriff.presenter.recorder"),object:nil)
        NotificationCenter.default.addObserver(self,selector:#selector(displayChanged),name:NSApplication.didChangeScreenParametersNotification,object:nil)
        NSWorkspace.shared.notificationCenter.addObserver(self,selector:#selector(stopAction),name:NSWorkspace.willSleepNotification,object:nil)
        NSWorkspace.shared.notificationCenter.addObserver(self,selector:#selector(stopAction),name:NSWorkspace.sessionDidResignActiveNotification,object:nil)
        combos=Keys.read(UserDefaults.standard.string(forKey:"hotkeys") ?? "")
        installHotKeys()
        publishState()
        // 실행할 때마다 안내를 모달로 띄우면, 그 창이 떠 있는 동안 사이드바에서 보낸 명령이
        // 하나도 전달되지 않는다(모달이 주 실행 루프를 잡는다). 사이드바가 앱을 대신 켜는
        // 경로에서 특히 나쁘다. 처음 한 번만 띄우고 다음부터는 메뉴 막대에 잠깐 표시만 한다.
        let seen="seenHelp"
        if UserDefaults.standard.bool(forKey:seen) {
            status.button?.title=" 준비됨"
            DispatchQueue.main.asyncAfter(deadline:.now()+3){[weak self] in
                guard let self=self, !self.active else {return}
                self.status.button?.title=self.status.button?.image==nil ? "다있쌤 ↗" : ""
            }
        } else {
            UserDefaults.standard.set(true,forKey:seen)
            help()
        }
    }
    func application(_ application:NSApplication,open urls:[URL]) { if urls.contains(where:{$0.scheme=="browsersheriff" && $0.host=="presenter"}) { startAction() } }
    // 안내 화면과 사이드바가 같은 글을 보여야 한다. 지금 등록된 조합에서 만들어 쓴다.
    func keyLines() -> String {
        let titles=[("snip","영역을 끌어 잘라 화면에 붙이기"),("clip","클립보드의 그림·글을 붙이기"),
                    ("clear","핀 모두 닫기"),("unlock","클릭 통과 모두 해제")]
        return titles.map{ (combos[$0.0]?.label ?? "?")+": "+$0.1 }.joined(separator:"\n")
    }
    @objc func help(){
        let a=NSAlert();let build=Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "?"
        a.messageText="다있쌤 · 발표 도우미 v"+build+"   만든이 다있쌤 로디"
        a.informativeText="메뉴 막대 오른쪽의 돋보기 아이콘을 누르고 ‘발표 시작’을 고르세요.\n\(combos["present"]?.label ?? "⌃⌥P"): 발표 시작 · 종료(앱이 켜져 있으면 늘 듣습니다)\n\nControl + Option + 마우스 휠: 1~4배 실시간 확대\nControl + Option + Shift + 휠: 집중 모드 원 크기\nEsc: 확대와 집중 모드를 한 번에 해제\n집중 모드(\(combos["focus"]?.label ?? "⌃⌥F")): 메뉴에서도 켜고 끕니다. 포인터 둘레만 선명하고 바깥은 흐려집니다.\n발표 종료: 큰 포인터와 화면 기록 종료\n\n[화면 조각 핀]\n메뉴 ‘화면 조각 핀’ 또는 단축키로 씁니다.\n\(keyLines())\n핀 위에서 휠 크기, Command + 휠 투명도, 오른쪽 클릭 메뉴, Esc 닫기.\n핀은 확대·집중 모드에 잡히지 않고 늘 또렷하게 위에 남습니다.\n\n아이콘이 보이지 않으면 메뉴 막대가 가득 찬 것입니다. Command 키를 누른 채 메뉴 막대 아이콘을 끌어 자리를 옮기거나 다른 앱 아이콘을 줄여 주세요.\n\n모니터가 여러 대면 마우스가 있는 화면에서 시작하고, 마우스를 다른 화면으로 옮기면 그쪽으로 따라갑니다(화면마다 따로 잡아야 해서 잠깐 끊깁니다). 화면 기록과 손쉬운 사용 권한이 필요합니다. 권한은 시스템 설정에서 직접 허용해 주세요. 화면은 저장하거나 전송하지 않습니다."
        a.addButton(withTitle:"확인");a.runModal()
    }
    @objc func startAction(){if !active && !starting { Task { await start() } }}
    @MainActor func start() async {
        starting=true;generation+=1;let token=generation
        defer{starting=false}
        // 여기서 모달 경고를 띄우면 그 창이 사이드바 명령을 전부 삼킨다. 알리기만 하고
        // 허용해야 할 자리를 바로 열어 준다.
        guard CGPreflightScreenCaptureAccess() else {
            CGRequestScreenCaptureAccess()
            tell("화면 기록 권한을 허용해 주세요")
            openSettings("Privacy_ScreenCapture")
            return
        }
        guard AXIsProcessTrusted() else {
            let opts=[kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String:true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(opts)
            tell("손쉬운 사용 권한을 허용해 주세요")
            openSettings("Privacy_Accessibility")
            return
        }
        do {
            guard let selected=NSScreen.screens.first(where:{$0.frame.contains(NSEvent.mouseLocation)}) ?? NSScreen.main else {
                throw NSError(domain:"화면을 찾을 수 없습니다.",code:1)
            }
            try await attach(to:selected,token:token)
            guard token==generation else{return}
            guard installTap() else {throw NSError(domain:"입력 감시를 시작하지 못했습니다. 손쉬운 사용 권한을 확인하세요.",code:3)}
            active=true;lastFrame=CFAbsoluteTimeGetCurrent();view?.ready=true;window?.orderFrontRegardless();publishState()
            startPointerTimer()
            status.button?.title=" 1.0×";updatePointer()
        }catch{stopAction();tell("발표를 시작하지 못했습니다 · 권한과 디스플레이를 확인해 주세요")}
    }
    // 한 모니터에 오버레이를 띄우고 그 화면을 잡는다. 모니터마다 따로 잡아야 하므로
    // 다른 모니터로 옮길 때도 이 과정을 그대로 다시 한다.
    @MainActor func attach(to selected: NSScreen, token: Int) async throws {
            guard let number=selected.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber else {throw NSError(domain:"화면을 찾을 수 없습니다.",code:1)}
            screen=selected;displayID=number.uint32Value
            let panel=NSPanel(contentRect:selected.frame,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
            panel.level = .screenSaver;panel.isOpaque=false;panel.backgroundColor = .clear;panel.hasShadow=false;panel.ignoresMouseEvents=true
            // sharingType 은 건드리지 않는다(기본값 = 화면 녹화에 담긴다). 예전에는 .none 이라
            // 확대·집중 모드가 **녹화 영상에 하나도 남지 않았다**(사용자 보고). 자기 화면을
            // 되먹임하지 않는 일은 아래 SCContentFilter 가 이 앱을 빼는 것으로 이미 한다.
            panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary];panel.hidesOnDeactivate=false
            let canvas=LiveView(frame:NSRect(origin:.zero,size:selected.frame.size))
            canvas.pointerSize=ringSize;canvas.dim=focusDim;canvas.ringColor=Presenter.color(ringHex)
            panel.contentView=canvas
            // 모니터를 옮길 때는 지금 배율·집중 상태를 그대로 이어 간다.
            canvas.scale=scale; canvas.focus=focus; canvas.focusRadius=focusRadius
            let old=window
            window=panel;view=canvas
            old?.vanish()
            // An accessory app with no on-screen window may be missing from the shareable list, which would
            // leave the exclusion empty and let the overlay capture itself. Show the panel first, then query.
            panel.orderFrontRegardless()
            let content=try await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true)
            guard token==generation else{return}
            guard let display=content.displays.first(where:{$0.displayID==displayID}) else {throw NSError(domain:"디스플레이에 접근할 수 없습니다.",code:2)}
            let own=content.applications.filter{$0.processID==ProcessInfo.processInfo.processIdentifier}
            // 이 앱의 창(오버레이·핀·카메라)은 '확대용 캡처' 에서만 뺀다. 그래야 확대 화면이
            // 스스로를 되먹이지 않고(v0.5.2 증상), 그러면서도 사용자의 화면 녹화에는 담긴다.
            // 앱 단위로 빼는 것이 첫 자물쇠, 창 목록으로 빼는 것이 두 번째다(목록이 비는 경우).
            let mine=content.windows.filter{$0.owningApplication?.processID==ProcessInfo.processInfo.processIdentifier}
            let filter=own.isEmpty ? SCContentFilter(display:display,excludingWindows:mine)
                                   : SCContentFilter(display:display,excludingApplications:own,exceptingWindows:[])
            let config=SCStreamConfiguration()
            config.width=Int(selected.frame.width*selected.backingScaleFactor)
            config.height=Int(selected.frame.height*selected.backingScaleFactor)
            config.minimumFrameInterval=CMTime(value:1,timescale:30);config.queueDepth=3;config.showsCursor=false;config.capturesAudio=false
            let capture=SCStream(filter:filter,configuration:config,delegate:self)
            try capture.addStreamOutput(self,type:.screen,sampleHandlerQueue:frameQueue)
            // 앞 모니터에서 돌던 캡처는 새 것이 뜬 뒤에 끊는다. 먼저 끊으면 화면이 한 번 깜빡인다.
            let previous=stream
            stream=capture
            try await capture.startCapture()
            if let previous=previous { try? await previous.stopCapture() }
            guard token==generation else{try? await capture.stopCapture();return}
            lastFrame=CFAbsoluteTimeGetCurrent();canvas.ready=true;panel.orderFrontRegardless()
    }
    func startPointerTimer(){
        let newTimer=Timer(timeInterval:1.0/30,target:self,selector:#selector(updatePointer),userInfo:nil,repeats:true)
        RunLoop.main.add(newTimer,forMode:.common);timer=newTimer
    }
    func installTap()->Bool{
        let events:[CGEventType]=[.scrollWheel,.keyDown,.mouseMoved,.leftMouseDragged,.rightMouseDragged]
        let mask=events.reduce(CGEventMask(0)){$0 | (CGEventMask(1)<<$1.rawValue)}
        let callback:CGEventTapCallBack={_,type,event,info in
            guard let info=info else{return Unmanaged.passUnretained(event)}
            let app=Unmanaged<Presenter>.fromOpaque(info).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {if let tap=app.tap{CGEvent.tapEnable(tap:tap,enable:true)};return Unmanaged.passUnretained(event)}
            // 조각 내기 화면이 떠 있는 동안에는 아무 것도 가로채지 않는다. 멈춘 그림이라 배율을
            // 바꿀 이유가 없고, Esc 는 그 화면이 직접 받아 취소해야 한다.
            if app.snip != nil { return Unmanaged.passUnretained(event) }
            // 핀 단축키는 RegisterEventHotKey 가 늘 받는다. 여기서 또 잡으면 두 번 실행된다.
            if type == .scrollWheel && event.flags.contains([.maskControl,.maskAlternate]) {
                let raw=event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
                if raw != 0 {
                    if event.flags.contains(.maskShift) && app.focus {
                        app.focusRadius=max(70,min(460,app.focusRadius+(raw>0 ? 12 : -12)))
                    } else {
                        app.scale=max(1,min(4,app.scale+(raw>0 ? 0.1 : -0.1)))
                    }
                    app.updatePointer()
                }
                return nil
            }
            if type == .keyDown, let combo=app.combos["focus"], combo.matches(event) {
                DispatchQueue.main.async { app.toggleFocus() }
                return nil
            }
            if type == .keyDown && event.getIntegerValueField(.keyboardEventKeycode)==53 {
                // 핀을 고른 상태의 Esc 는 그 핀 하나만 닫는다. 여기서 삼켜 버리면 핀마다 닫을 길이 없다.
                if NSApp.keyWindow is PinWindow { return Unmanaged.passUnretained(event) }
                if app.scale>1 || app.focus {
                    app.scale=1;app.focus=false;app.view?.focus=false;app.updatePointer()
                } else {
                    // The menu bar sits under the overlay, so Esc is the only way out while presenting.
                    DispatchQueue.main.async { app.stopAction() }
                }
                return nil
            }
            app.updatePointer();return Unmanaged.passUnretained(event)
        }
        tap=CGEvent.tapCreate(tap:.cgSessionEventTap,place:.headInsertEventTap,options:.defaultTap,eventsOfInterest:mask,callback:callback,userInfo:Unmanaged.passUnretained(self).toOpaque())
        guard let tap=tap else{return false}
        tapSource=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0)
        CFRunLoopAddSource(CFRunLoopGetMain(),tapSource,.commonModes);CGEvent.tapEnable(tap:tap,enable:true);return true
    }
    @objc func updatePointer(){
        // 조각을 내는 동안에는 오버레이를 숨겨 둔다. 여기서 막지 않으면 다음 틱에 도로 올라온다.
        guard active,snip==nil,let screen=screen,let view=view else{return}
        var point=NSEvent.mouseLocation
        // 모니터가 여러 대면 커서를 따라 그 화면으로 옮겨 간다. 화면마다 따로 잡아야 해서
        // 잠깐 끊기므로, 경계에서 왔다 갔다 할 때 계속 다시 잡지 않도록 사이를 둔다.
        if !screen.frame.contains(point){
            if followMouse(point){return}
            // 커서를 화면 맨 위로 끝까지 밀면 NSEvent 가 frame.maxY 와 똑같은 값을 준다.
            // NSRect.contains 는 maxY 를 바깥으로 보므로, 예전에는 이것을 ‘다른 모니터로
            // 나갔다’로 읽어 오버레이를 내려 버렸다(맨 위 한 줄에서만 확대가 사라지고,
            // 커서를 내리면 되살아나던 까닭). 옮겨 갈 화면이 없으면 내리지 말고 테두리
            // 안으로 당겨 그대로 그린다. 모니터 사이의 빈틈도 같은 방법으로 지나간다.
            point=NSPoint(x:min(max(point.x,screen.frame.minX),screen.frame.maxX-1),
                          y:min(max(point.y,screen.frame.minY),screen.frame.maxY-1))
        }
        window?.orderFrontRegardless()
        view.pointer=CGPoint(x:point.x-screen.frame.minX,y:point.y-screen.frame.minY);pointerNow=view.pointer;view.scale=scale;view.focus=focus;view.focusRadius=focusRadius;view.dim=focusDim;view.pointerSize=ringSize;view.ringColor=Presenter.color(ringHex);view.focusLabel=combos["focus"]?.label ?? "⌃⌥F";view.needsDisplay=true
        status.button?.title=focus ? String(format:" %.1f× ◉",Double(scale)) : String(format:" %.1f×",Double(scale))
    }
    // 커서가 있는 모니터로 발표를 옮긴다. 옮길 것이 있으면 true.
    func followMouse(_ point: NSPoint) -> Bool {
        guard !moving, !starting, active else { return false }
        guard CFAbsoluteTimeGetCurrent()-movedAt > 0.6 else { return true }   // 경계에서 떨리는 것 막기
        guard let next=NSScreen.screens.first(where:{$0.frame.contains(point)}),
              let number=next.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              number.uint32Value != displayID else { return false }
        moving=true; movedAt=CFAbsoluteTimeGetCurrent()
        generation+=1; let token=generation
        Task { @MainActor in
            defer { moving=false; movedAt=CFAbsoluteTimeGetCurrent() }
            do { try await attach(to:next,token:token) }
            catch { tell("그 화면으로 옮기지 못했습니다"); return }
            guard token==generation else { return }
            updatePointer()
        }
        return true
    }
    // 화면에 실제로 그려질 부분만 돌려준다. nil 이면 이번 프레임은 한 장도 만들 필요가 없다.
    // 1배이고 집중 모드가 꺼져 있으면 LiveView.draw 가 그림을 아예 쓰지 않는다. 그때 변환하면
    // 만들어서 그대로 버리는 셈이라 전체 비용의 대부분이 거기서 샌다(측정: 코어의 21%).
    func needed(_ size: NSSize) -> NSRect? {
        let whole=NSRect(origin:.zero,size:size)
        let crop=NSRect(x:pointerNow.x*(1-1/scale),y:pointerNow.y*(1-1/scale),
                        width:size.width/scale,height:size.height/scale)
        if focus {
            // 선명하게 보이는 곳은 원 안쪽뿐이다. 그 원이 원본에서 차지하는 자리만 가져온다.
            // 프레임 사이에 포인터가 움직일 수 있어 조금 넉넉하게 둔다.
            let radius=focusRadius/scale, pad=90/scale
            let centre=NSPoint(x:crop.minX+pointerNow.x/scale,y:crop.minY+pointerNow.y/scale)
            return NSRect(x:centre.x-radius-pad,y:centre.y-radius-pad,
                          width:(radius+pad)*2,height:(radius+pad)*2).intersection(whole)
        }
        if scale > 1 { return crop.intersection(whole) }
        return nil
    }
    func stream(_ stream:SCStream,didOutputSampleBuffer sampleBuffer:CMSampleBuffer,of type:SCStreamOutputType){
        guard type == .screen,let buffer=sampleBuffer.imageBuffer,let size=screen?.frame.size else{return}
        guard let want=needed(size),want.width>=1,want.height>=1 else{return}
        let image=CIImage(cvPixelBuffer:buffer)
        let factor=image.extent.width/max(1,size.width)
        let pixels=CGRect(x:want.minX*factor,y:want.minY*factor,
                          width:want.width*factor,height:want.height*factor).integral.intersection(image.extent)
        guard pixels.width>=1,pixels.height>=1,let cg=context.createCGImage(image,from:pixels) else{return}
        // 잘라낸 픽셀이 실제로 덮는 화면 영역. 정수로 맞추면서 생긴 차이를 그대로 반영한다.
        let covered=NSRect(x:pixels.minX/factor,y:pixels.minY/factor,width:pixels.width/factor,height:pixels.height/factor)
        // Blur by downscaling: a full resolution Gaussian at 30fps is far more work than this needs.
        var blur: CGImage? = nil
        let now=CFAbsoluteTimeGetCurrent()
        if focus, now-lastBlur > 0.1, let small=CIFilter(name:"CILanczosScaleTransform",parameters:[kCIInputImageKey:image,kCIInputScaleKey:1/blurLevel])?.outputImage {
            blur=context.createCGImage(small,from:small.extent); lastBlur=now
        }
        DispatchQueue.main.async{[weak self] in
            guard let self=self,self.active,stream === self.stream,let view=self.view else{return}
            view.piece=NSImage(cgImage:cg,size:covered.size);view.pieceRect=covered
            if let blur=blur {view.blurImage=NSImage(cgImage:blur,size:view.bounds.size)}
            self.lastFrame=CFAbsoluteTimeGetCurrent();view.needsDisplay=true
        }
    }
    func stream(_ stream:SCStream,didStopWithError error:Error){DispatchQueue.main.async{[weak self] in self?.stopAction();self?.tell("화면 연결이 끊겨 발표를 끝냈습니다")}}
    @objc func stopAction(){
        generation+=1;active=false;scale=1;focus=false;timer?.invalidate();timer=nil
        if cursorHidden{CGDisplayShowCursor(displayID);cursorHidden=false}
        CGDisplayShowCursor(displayID)
        if let tap=tap{CGEvent.tapEnable(tap:tap,enable:false);CFMachPortInvalidate(tap)};tap=nil
        if let source=tapSource{CFRunLoopRemoveSource(CFRunLoopGetMain(),source,.commonModes)};tapSource=nil
        window?.vanish();window=nil;view=nil
        publishState()
        if let stream=stream{Task{try? await stream.stopCapture()}};stream=nil;status?.button?.title=status?.button?.image==nil ? "다있쌤 ↗" : ""
    }
    static var stateFile: URL? {
        FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask).first?
            .appendingPathComponent("BrowserSheriff/state.json")
    }
    func publishState(){
        syncWheelTap()
        guard let file=Presenter.stateFile else {return}
        try? FileManager.default.createDirectory(at:file.deletingLastPathComponent(),withIntermediateDirectories:true)
        let payload:[String:Any]=["presenting":active,"focus":focus,"pins":pins.count,"hotkeys":hotKeys.count,"through":pins.filter{$0.through}.count,"keys":Keys.text(combos),"badge":badge != nil,"camera":camera != nil]
        try? JSONSerialization.data(withJSONObject:payload).write(to:file)
    }
    @objc func toggleFocus(){
        guard active else {
            // 집중 모드는 화면을 읽어야 그릴 수 있다. 발표를 먼저 켜고 이어서 집중 모드로 들어간다.
            // 예전에는 여기서 모달 경고를 띄웠고, 그 창이 사이드바 명령을 전부 삼켰다.
            guard !starting else { return }
            tell("집중 모드를 준비합니다…")
            Task { @MainActor in
                await start()
                guard self.active else { return }
                self.focus=true; self.view?.focus=true
                self.updatePointer(); self.publishState()
            }
            return
        }
        focus = !focus
        if !focus { view?.blurImage=nil }
        view?.focus=focus;updatePointer();publishState()
    }
    @objc func setBlur(_ sender: NSMenuItem){blurLevel=max(2,CGFloat(sender.tag));view?.blurImage=nil;updatePointer()}
    var hostManifest: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/Google/Chrome/NativeMessagingHosts/app.browsersheriff.presenter.json")
    }
    @objc func registerHost(){
        guard let path=Bundle.main.executablePath else {showError("앱 경로를 찾을 수 없습니다.");return}
        let manifest: [String:Any]=["name":"app.browsersheriff.presenter","description":"다있쌤 클립보드 도우미",
                                    "path":path,"type":"stdio",
                                    "allowed_origins":NativeHost.extensionIDs.map{"chrome-extension://\($0)/"}]
        do {
            try FileManager.default.createDirectory(at:hostManifest.deletingLastPathComponent(),withIntermediateDirectories:true)
            try JSONSerialization.data(withJSONObject:manifest,options:[.prettyPrinted]).write(to:hostManifest)
            showError("클립보드 도우미를 등록했습니다.\n확장 사이드 패널에서 메모 위 토글을 켜면 연결됩니다.\n앱을 다른 폴더로 옮기면 다시 등록해 주세요.\nChrome을 다시 시작해야 할 수 있습니다.")
        } catch { showError("등록하지 못했습니다.\n"+error.localizedDescription) }
    }
    @objc func unregisterHost(){
        do {
            if FileManager.default.fileExists(atPath:hostManifest.path) { try FileManager.default.removeItem(at:hostManifest) }
            showError("클립보드 도우미 등록을 해제했습니다. 바탕화면에 저장된 캡처 파일은 그대로 남습니다.")
        } catch { showError("해제하지 못했습니다.\n"+error.localizedDescription) }
    }
    // 사이드바에서 보낸 명령. 네이티브 도우미가 이 알림으로 넘겨준다.
    @objc func remoteCommand(_ note: Notification){
        let info=note.userInfo as? [String:String] ?? [:]
        // 분산 알림이 주 스레드로 온다는 보장이 없다. 다른 스레드에서 AppKit 을 만지면 창을
        // 내리는 것 같은 조작이 조용히 무시된다(핀을 닫아도 화면에 남던 원인).
        if Thread.isMainThread { apply(info) }
        else { DispatchQueue.main.async{[weak self] in self?.apply(info)} }
    }
    // 확장이 녹화를 시작·갱신·끝낼 때 온다. 표시기는 화면 녹화에 담기지 않는다.
    @objc func recorderCommand(_ note: Notification){
        let info=note.userInfo as? [String:String] ?? [:]
        if Thread.isMainThread { applyBadge(info) }
        else { DispatchQueue.main.async{[weak self] in self?.applyBadge(info)} }
    }
    func applyBadge(_ info:[String:String]){
        if info["action"]=="hide" {
            badgeWatch?.invalidate(); badgeWatch=nil
            badge?.dismiss(); badge=nil; closeCamera(); recordDisplay=""; publishState(); return
        }
        if let where_=info["display"], !where_.isEmpty { recordDisplay=where_ }
        if badge==nil {
            let panel=BadgePanel()
            panel.onButton={[weak self] which in self?.badgeTap(which)}
            panel.place(on:screenForCapture(recordDisplay))
            panel.orderFrontRegardless()
            badge=panel
        }
        // 녹화 창이 말없이 사라지면(창을 닫았거나 확장을 새로 읽었거나) 표시기와 카메라 창이
        // 화면에 그대로 남았다. 12초 동안 소식이 없으면 스스로 거둔다.
        badgeWatch?.invalidate()
        let watch=Timer(timeInterval:12,repeats:false){ [weak self] _ in
            guard let self=self else { return }
            self.badge?.dismiss(); self.badge=nil; self.closeCamera(); self.recordDisplay=""; self.publishState()
        }
        RunLoop.main.add(watch,forMode:.common)
        badgeWatch=watch
        badge?.update(time:info["time"] ?? "00:00",paused:info["paused"]=="1",camera:info["camera"]=="1")
        // 전체 화면 녹화에서 카메라를 켜면 동그란 카메라 창을 띄운다. 이 창은 녹화에 담긴다.
        // 값이 없는 알림(1초마다 오는 시간 갱신)에는 손대지 않는다. 예전에는 여기서 닫아 버려
        // 카메라 동그라미가 뜨자마자 사라졌다.
        if let wanted=info["cameraView"] {
            if wanted=="1" { openCamera(info["cameraName"] ?? "") } else { closeCamera() }
        }
        publishState()
    }
    func openCamera(_ name: String){
        guard camera==nil else { return }
        // 확장이 '화면 전체를 담는다' 고 알려 줬는데(recordDisplay 가 있음) 그 모니터를
        // 가려내지 못했으면 띄우지 않는다 — 엉뚱한 모니터에 뜨면 녹화 영상에 카메라가
        // 남지 않는다. 안 띄우면 확장이 영상 안에 합쳐 넣는다.
        // 탭·창을 담을 때는 recordDisplay 가 비어 있다. 그때는 어디 떠 있어도 되므로 띄운다
        // (찍는 동안 내 모습을 보는 것이 목적이고, 영상에는 확장이 따로 합쳐 넣는다).
        let onScreen=screenForCapture(recordDisplay)
        if !recordDisplay.isEmpty && NSScreen.screens.count > 1 && onScreen == nil {
            tell("녹화 중인 모니터를 가리지 못해 카메라를 영상 안에 담습니다")
            return
        }
        let panel=CameraPanel(side:220)
        guard panel.begin(name:name) else {
            // 권한을 아직 안 줬거나 카메라가 없다. 확장이 영상 안에 합쳐 넣는다.
            if AVCaptureDevice.authorizationStatus(for:.video) == .notDetermined {
                tell("카메라 사용을 허용하면 다음 녹화부터 동그란 카메라 창이 보입니다")
            }
            return
        }
        panel.place(on:onScreen)
        panel.orderFrontRegardless()
        camera=panel
    }
    func closeCamera(){ camera?.dismiss(); camera=nil }
    // 녹화 전에 한 번 열어 보는 자리. 처음 열 때 카메라 권한을 묻고, 허용하면 그 뒤 녹화에서 바로 보인다.
    @objc func previewCamera(){
        if camera != nil { closeCamera(); return }
        openCamera("")
        if camera != nil { tell("녹화를 시작하면 이 창이 저절로 뜹니다 · 끌어서 옮기세요") }
        DispatchQueue.main.asyncAfter(deadline:.now()+6){ [weak self] in self?.closeCamera() }
    }
    // 클릭 통과를 켠 핀은 마우스를 받지 않는다. 그래도 그 핀 위에서 휠을 굴리면 투명도가
    // 바뀌어야 한다(사용자 요청). 통과 핀이 하나라도 있는 동안만 휠 이벤트를 가로챈다.
    // 손쉬운 사용 권한이 없으면 가로채기가 만들어지지 않는다 — 그때는 조용히 넘어간다.
    func syncWheelTap(){
        guard Thread.isMainThread else { DispatchQueue.main.async{[weak self] in self?.syncWheelTap()}; return }
        if pins.contains(where:{ $0.through }) { installWheelTap() } else { removeWheelTap() }
    }
    func installWheelTap(){
        guard wheelTap==nil else { return }
        let mask=CGEventMask(1)<<CGEventType.scrollWheel.rawValue
        let callback:CGEventTapCallBack={_,type,event,info in
            guard let info=info else { return Unmanaged.passUnretained(event) }
            let app=Unmanaged<Presenter>.fromOpaque(info).takeUnretainedValue()
            if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                if let tap=app.wheelTap { CGEvent.tapEnable(tap:tap,enable:true) }
                return Unmanaged.passUnretained(event)
            }
            guard type == .scrollWheel, app.snip==nil else { return Unmanaged.passUnretained(event) }
            let raw=event.getIntegerValueField(.scrollWheelEventDeltaAxis1)
            guard raw != 0 else { return Unmanaged.passUnretained(event) }
            let point=NSEvent.mouseLocation
            // 마우스 아래에 있는 통과 핀 중 가장 앞의 것.
            let hit=app.pins.filter{ $0.through && $0.isVisible && $0.frame.contains(point) }
                            .min(by:{ $0.orderedIndex < $1.orderedIndex })
            guard let pin=hit else { return Unmanaged.passUnretained(event) }
            DispatchQueue.main.async { pin.setShade(pin.shade+(raw>0 ? 0.06 : -0.06)) }
            // 아래 앱으로는 넘기지 않는다. 넘기면 투명도와 함께 페이지까지 굴러간다.
            return nil
        }
        wheelTap=CGEvent.tapCreate(tap:.cgSessionEventTap,place:.headInsertEventTap,options:.defaultTap,
                                   eventsOfInterest:mask,callback:callback,userInfo:Unmanaged.passUnretained(self).toOpaque())
        guard let tap=wheelTap else { return }
        wheelSource=CFMachPortCreateRunLoopSource(kCFAllocatorDefault,tap,0)
        CFRunLoopAddSource(CFRunLoopGetMain(),wheelSource,.commonModes)
        CGEvent.tapEnable(tap:tap,enable:true)
    }
    func removeWheelTap(){
        if let source=wheelSource { CFRunLoopRemoveSource(CFRunLoopGetMain(),source,.commonModes) }
        if let tap=wheelTap { CGEvent.tapEnable(tap:tap,enable:false) }
        wheelSource=nil; wheelTap=nil
    }
    func badgeTap(_ which: String){
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("app.browsersheriff.recorder.button"),object:nil,
            userInfo:["button":which],deliverImmediately:true)
        if which=="stop" || which=="cancel" { badge?.dismiss(); badge=nil }
    }
    func apply(_ info:[String:String]){
        if let hex=info["ring"] { ringHex=hex; view?.ringColor=Presenter.color(hex) }
        if let raw=info["ringSize"], let value=Double(raw) { ringSize=CGFloat(max(12,min(160,value))); view?.pointerSize=ringSize }
        if let raw=info["dim"], let value=Double(raw) { focusDim=CGFloat(max(0,min(0.9,value))); view?.dim=focusDim }
        if let raw=info["blur"], let value=Double(raw) { blurLevel=CGFloat(max(2,min(30,value))); view?.blurImage=nil }
        if let raw=info["keys"] { setHotkeys(raw) }
        switch info["action"] {
        case "start": startAction()
        case "stop": stopAction()
        // 발표 중이 아니어도 켤 수 있어야 한다. toggleFocus 가 발표를 함께 켠다.
        // 여기에 active 조건이 남아 있어 사이드바 명령이 통째로 무시되고 있었다.
        case "focus-on": if !focus { toggleFocus() }
        case "focus-off": if active && focus { toggleFocus() }
        case "focus": toggleFocus()
        case "snip": snipAction()
        // 도크의 ‘선택 영역 캡처’. 브라우저 탭이 아니라 화면 전체에서 고른다(다른 앱·다른 모니터도).
        case "snip-save": snipSaveAction()
        case "pin-clip": pinClipboard()
        case "pins-clear": clearPins()
        case "pins-unlock": unlockPins()
        case "pins-through": throughPins()
        default: break
        }
        if active { updatePointer() }
    }
    static func color(_ hex: String) -> NSColor {
        var text=hex.trimmingCharacters(in:.whitespaces)
        if text.hasPrefix("#") { text.removeFirst() }
        guard text.count == 6, let value=UInt32(text,radix:16) else { return NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1) }
        return NSColor(calibratedRed:CGFloat((value>>16)&0xff)/255,green:CGFloat((value>>8)&0xff)/255,blue:CGFloat(value&0xff)/255,alpha:1)
    }
    @objc func displayChanged(){
        for pin in pins { pin.layout() }
        // 모니터가 빠지면 그 화면에 있던 창이 갈 곳을 잃는다. 남은 화면으로 다시 데려온다.
        for panel in [badge as NSWindow?, camera as NSWindow?].compactMap({$0}) {
            if !NSScreen.screens.contains(where:{ $0.frame.intersects(panel.frame) }) {
                if let badge=panel as? BadgePanel { badge.place(on:screenInUse()) }
                if let camera=panel as? CameraPanel { camera.place(on:screenInUse()) }
                panel.orderFrontRegardless()
            }
        }
        if active||starting { stopAction(); tell("디스플레이가 바뀌어 발표를 끝냈습니다") }
    }
    func openSettings(_ pane: String) {
        if let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?"+pane) {
            NSWorkspace.shared.open(url)
        }
    }
    func showError(_ text:String){let a=NSAlert();a.messageText="발표 도우미";a.informativeText=text;a.runModal()}
    // 모달 경고창은 주 실행 루프를 잡는다. 그 동안 사이드바 명령도 메뉴도 전혀 듣지 않는다.
    // 사이드바에서 온 일로 알릴 때는 막지 않는 쪽지를 쓴다.
    func tell(_ text: String) {
        notice?.vanish(); notice=nil
        guard let screen=NSScreen.screens.first(where:{$0.frame.contains(NSEvent.mouseLocation)}) ?? NSScreen.main else { return }
        let style:[NSAttributedString.Key:Any]=[.font:NSFont.boldSystemFont(ofSize:14),.foregroundColor:NSColor.white]
        let size=(text as NSString).size(withAttributes:style)
        let wide=min(screen.frame.width-80,size.width+36), tall=size.height+26
        let where_=NSRect(x:screen.frame.midX-wide/2,y:screen.frame.maxY-tall-70,width:wide,height:tall)
        let panel=NSPanel(contentRect:where_,styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        panel.isOpaque=false; panel.backgroundColor = .clear; panel.hasShadow=true
        panel.ignoresMouseEvents=true; panel.sharingType = .none
        panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]
        panel.hidesOnDeactivate=false; panel.isReleasedWhenClosed=false
        panel.level=Pin.snipLevel
        let view=NoticeView(frame:NSRect(origin:.zero,size:where_.size)); view.text=text
        panel.contentView=view
        notice=panel
        panel.orderFrontRegardless()
        DispatchQueue.main.asyncAfter(deadline:.now()+2.6){[weak self] in
            if self?.notice === panel { panel.vanish(); self?.notice=nil }
        }
    }
    // MARK: 화면 조각 핀 동작
    // 발표 중에만 듣던 단축키를 늘 듣게 한다. RegisterEventHotKey 는 입력 감시(이벤트 탭)와
    // 달리 손쉬운 사용 권한을 요구하지 않아, 앱을 켜 두기만 하면 바로 쓸 수 있다.
    func installHotKeys() {
        // 사용자가 조합을 바꾸면 다시 부른다. 먼저 걷어 내지 않으면 옛 조합이 함께 남는다.
        for ref in hotKeys { UnregisterEventHotKey(ref) }
        hotKeys=[]
        // 받는 자리는 한 번만 단다. 다시 달면 한 번 누른 것이 두 번 실행된다.
        if !hotKeyHandler {
            var spec=EventTypeSpec(eventClass:OSType(kEventClassKeyboard),eventKind:UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _,event,info in
                guard let info=info, let event=event else { return noErr }
                var which=EventHotKeyID()
                GetEventParameter(event,EventParamName(kEventParamDirectObject),EventParamType(typeEventHotKeyID),
                                  nil,MemoryLayout<EventHotKeyID>.size,nil,&which)
                let app=Unmanaged<Presenter>.fromOpaque(info).takeUnretainedValue()
                DispatchQueue.main.async { app.hotKey(which.id) }
                return noErr
            },1,&spec,Unmanaged.passUnretained(self).toOpaque(),nil)
            hotKeyHandler=true
        }
        // 1~5 는 hotKey(_:) 의 갈래 번호다. 발표 시작은 발표 전에 눌러야 뜻이 있으므로
        // 반드시 여기(늘 듣는 자리)에 있어야 한다. 집중 모드만 발표 중에 듣는 것이어서
        // 이벤트 탭이 받는다(탭은 발표 중에만 걸려 있다).
        for (index,name) in ["snip","clip","clear","unlock","present"].enumerated() {
            guard let combo=combos[name] else { continue }
            var ref: EventHotKeyRef?
            let id=EventHotKeyID(signature:OSType(0x42534846),id:UInt32(index+1))   // 'BSHF'
            if RegisterEventHotKey(combo.code,combo.mods,id,GetApplicationEventTarget(),0,&ref)==noErr, let ref=ref {
                hotKeys.append(ref)
            }
        }
    }
    // 사이드바가 보낸 단축키를 받아 둔다. 같은 값이면 등록을 흔들지 않는다.
    func setHotkeys(_ text: String) {
        let next=Keys.read(text)
        guard next != combos else { return }
        combos=next
        UserDefaults.standard.set(text,forKey:"hotkeys")
        installHotKeys()
        publishState()
        view?.focusLabel=combos["focus"]?.label ?? "⌃⌥F"
        view?.needsDisplay=true
    }
    func hotKey(_ id: UInt32) {
        switch id {
        case 1: snipAction()
        case 2: pinClipboard()
        case 3: clearPins()
        case 4: unlockPins()
        // 한 키로 켜고 끈다. 발표 중에는 화면이 메뉴 막대를 덮으므로 이 길이 가장 빠르다.
        case 5: if active { stopAction() } else { startAction() }
        default: break
        }
    }
    @objc func snipAction(){ Task { await beginSnip() } }
    @objc func snipSaveAction(){ Task { await beginSnip(save:true) } }
    @objc func clearPinsAction(){ clearPins() }
    func forget(_ pin: PinWindow){ pins.removeAll{ $0 === pin }; publishState() }
    func clearPins(){
        // 목록을 먼저 비운다. close 가 forget 을 다시 부르므로 순회 중에 배열이 바뀌면 안 된다.
        let all=pins; pins=[]
        for pin in all { pin.orderOut(nil); pin.close() }
        publishState()
    }
    // 클릭 통과를 켠 핀은 눌러도 반응하지 않으므로 이 길이 유일한 되돌리기다.
    @objc func unlockPins(){
        let count=pins.filter{$0.through}.count
        for pin in pins where pin.through { pin.setThrough(false) }
        publishState()
        tell(count>0 ? "핀 \(count)개를 다시 누를 수 있게 했습니다" : "클릭 통과를 켠 핀이 없습니다")
    }
    // 핀 위에서만 켤 수 있으면 켜고 끄는 길이 어긋난다. 바깥에서도 똑같이 켜고 끈다.
    @objc func throughPins(){
        guard !pins.isEmpty else { tell("붙여 둔 핀이 없습니다"); return }
        let wanted = !pins.contains{ $0.through }
        for pin in pins { pin.setThrough(wanted) }
        publishState()
        tell(wanted ? "핀 \(pins.count)개가 클릭을 통과시킵니다" : "핀 \(pins.count)개를 다시 누를 수 있게 했습니다")
    }
    func addPin(_ image: NSImage, at centre: NSPoint){
        guard image.size.width>0, image.size.height>0 else { tell("붙일 그림이 비어 있습니다"); return }
        guard pins.count < Pin.maxCount else { tell("핀은 \(Pin.maxCount)개까지 띄울 수 있습니다"); return }
        let pin=PinWindow(image:image,host:self,centre:centre)
        pins.append(pin)
        pin.orderFrontRegardless()
        publishState()
    }
    @objc func pinClipboard(){
        let board=NSPasteboard.general
        if let image=NSImage(pasteboard:board), image.size.width>0 { addPin(image,at:NSEvent.mouseLocation); return }
        if let text=board.string(forType:.string), !text.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty {
            addPin(Presenter.card(text),at:NSEvent.mouseLocation); return
        }
        tell("클립보드에 붙일 그림이나 글이 없습니다")
    }
    // 글도 붙일 수 있어야 한다. 그림 창 하나로 다루려고 글을 카드로 그려 둔다.
    static func card(_ text: String) -> NSImage {
        let body=String(text.prefix(1200))
        let style=NSMutableParagraphStyle(); style.lineSpacing=3
        let marks:[NSAttributedString.Key:Any]=[.font:NSFont.systemFont(ofSize:18),.foregroundColor:NSColor.black,.paragraphStyle:style]
        let rich=NSAttributedString(string:body,attributes:marks)
        let bound=rich.boundingRect(with:NSSize(width:520,height:1400),options:[.usesLineFragmentOrigin,.usesFontLeading])
        let size=NSSize(width:min(560,max(180,ceil(bound.width)+32)),height:min(1440,max(64,ceil(bound.height)+28)))
        let made=NSImage(size:size)
        made.lockFocus()
        NSColor(calibratedRed:1,green:0.99,blue:0.92,alpha:1).setFill(); NSRect(origin:.zero,size:size).fill()
        rich.draw(in:NSRect(x:16,y:14,width:size.width-32,height:size.height-28))
        made.unlockFocus()
        return made
    }
    // 바탕화면 감시기가 다시 가져가지 않도록 캡처와 다른 이름을 쓴다.
    static func savePin(_ image: NSImage) -> String? {
        guard let folder=Shots.folder,
              let tiff=image.tiffRepresentation, let rep=NSBitmapImageRep(data:tiff),
              let png=rep.representation(using:.png,properties:[:]) else { return nil }
        let stamp=DateFormatter(); stamp.dateFormat="yyyyMMdd-HHmmss"
        var name=Pin.prefix+stamp.string(from:Date())+".png"
        var target=folder.appendingPathComponent(name)
        var counter=1
        while FileManager.default.fileExists(atPath:target.path) {
            counter += 1
            name=Pin.prefix+stamp.string(from:Date())+"-\(counter).png"
            target=folder.appendingPathComponent(name)
        }
        do { try png.write(to:target) } catch { return nil }
        return name
    }
    @available(macOS 14.0,*)
    func stillImage(of screen: NSScreen, display: CGDirectDisplayID) async -> CGImage? {
        guard let content=try? await SCShareableContent.excludingDesktopWindows(false,onScreenWindowsOnly:true),
              let target=content.displays.first(where:{$0.displayID==display}) else { return nil }
        let own=content.applications.filter{$0.processID==ProcessInfo.processInfo.processIdentifier}
        let filter=own.isEmpty ? SCContentFilter(display:target,excludingWindows:[])
                               : SCContentFilter(display:target,excludingApplications:own,exceptingWindows:[])
        let config=SCStreamConfiguration()
        config.width=Int(screen.frame.width*screen.backingScaleFactor)
        config.height=Int(screen.frame.height*screen.backingScaleFactor)
        config.showsCursor=false
        return try? await SCScreenshotManager.captureImage(contentFilter:filter,configuration:config)
    }
    // save 면 고른 조각을 핀으로 띄우지 않고 ‘캡처이미지’ 폴더에 저장하고 클립보드에 복사한다.
    // 모니터가 여러 대면 화면마다 덮개를 하나씩 올린다 — 다른 모니터 위의 앱도 고를 수 있어야 한다.
    @MainActor func beginSnip(save: Bool=false) async {
        guard snip==nil else { return }
        guard CGPreflightScreenCaptureAccess() else {
            CGRequestScreenCaptureAccess()
            tell("화면 기록 권한을 허용해 주세요")
            openSettings("Privacy_ScreenCapture")
            return
        }
        guard #available(macOS 14.0,*) else {
            tell("화면 조각 잘라내기는 macOS 14 이상에서 됩니다")
            return
        }
        snipSave=save
        // 확대 중이면 눈에 보이는 위치와 실제 화면 좌표가 어긋난다. 조각 내는 동안만 원래 크기로 돌린다.
        snipRestore=(scale,focus)
        if active {
            scale=1
            if focus { focus=false; view?.focus=false; view?.blurImage=nil }
            view?.ready=false; window?.orderOut(nil); publishState()
        }
        var made:[(SnipOverlay,NSScreen)]=[]
        for screen in NSScreen.screens {
            guard let number=screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
                  let shot=await stillImage(of:screen,display:number.uint32Value) else { continue }
            let panel=SnipOverlay(contentRect:screen.frame,styleMask:[.borderless],backing:.buffered,defer:false)
            panel.level=Pin.snipLevel; panel.isOpaque=true; panel.backgroundColor = .black; panel.hasShadow=false
            // 발표 오버레이와 같은 약속. 조각 화면 자체가 다음 캡처에 끼어들지 않게 한다.
            panel.sharingType = .none
            panel.collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]; panel.hidesOnDeactivate=false
            let canvas=SnipView(frame:NSRect(origin:.zero,size:screen.frame.size))
            canvas.shot=NSImage(cgImage:shot,size:screen.frame.size)
            canvas.done={[weak self] box in self?.finishSnip(box:box,screen:screen,shot:shot)}
            canvas.cancelled={[weak self] in self?.endSnip()}
            panel.contentView=canvas
            panel.setFrame(screen.frame,display:false)
            made.append((panel,screen))
        }
        guard !made.isEmpty else {
            restoreAfterSnip(); tell("화면을 읽지 못했습니다 · 화면 기록 권한을 확인해 주세요"); return
        }
        // 한 대라도 못 읽으면 그 모니터에서는 고를 수 없다. 조용히 넘어가지 않는다.
        if made.count < NSScreen.screens.count {
            tell("모니터 \(NSScreen.screens.count)대 중 \(made.count)대만 읽었습니다")
        }
        // 마우스가 있는 화면의 덮개가 키 창이 된다. Esc 도 그 창이 받는다.
        let here=NSEvent.mouseLocation
        let first=made.firstIndex(where:{ $0.1.frame.contains(here) }) ?? 0
        snip=made[first].0
        snipMore=made.enumerated().filter{ $0.offset != first }.map{ $0.element.0 }
        NSApp.activate(ignoringOtherApps:true)
        for panel in snipMore { panel.orderFrontRegardless() }
        made[first].0.makeKeyAndOrderFront(nil)
        made[first].0.makeFirstResponder(made[first].0.contentView)
    }
    func finishSnip(box: NSRect, screen: NSScreen, shot: CGImage){
        let saving=snipSave
        endSnip()
        // CGImage 는 원점이 왼쪽 위, 화면 좌표는 왼쪽 아래다.
        let factor=CGFloat(shot.width)/max(1,screen.frame.width)
        let pixels=CGRect(x:box.minX*factor,y:(screen.frame.height-box.maxY)*factor,
                          width:box.width*factor,height:box.height*factor).integral
        guard pixels.width>=1, pixels.height>=1, let cut=shot.cropping(to:pixels) else {
            tell("조금 더 넓게 끌어 주세요"); return
        }
        let image=NSImage(cgImage:cut,size:NSSize(width:box.width,height:box.height))
        guard saving else {
            addPin(image,at:NSPoint(x:screen.frame.minX+box.midX,y:screen.frame.minY+box.midY))
            return
        }
        let board=NSPasteboard.general
        board.clearContents()
        let copied=board.writeObjects([image])
        let saved=Presenter.savePin(image)
        if saved != nil && copied { tell("‘캡처이미지’ 폴더에 저장하고 클립보드에 복사했습니다") }
        else if saved != nil { tell("‘캡처이미지’ 폴더에 저장했습니다") }
        else if copied { tell("클립보드에 복사했습니다 · 폴더에 저장하지 못했습니다") }
        else { tell("저장도 복사도 하지 못했습니다") }
    }
    func endSnip(){
        snip?.vanish(); snip=nil
        for panel in snipMore { panel.vanish() }
        snipMore=[]
        snipSave=false
        restoreAfterSnip()
    }
    func restoreAfterSnip(){
        if let (oldScale,oldFocus)=snipRestore, active {
            scale=oldScale
            if oldFocus { focus=true; view?.focus=true }
            view?.ready=true; window?.orderFrontRegardless(); updatePointer(); publishState()
        }
        snipRestore=nil
    }
    @objc func quit(){stopAction();NSApp.terminate(nil)}
    func applicationWillTerminate(_ notification:Notification){stopAction()}
}

// MARK: 화면 조각 핀 (Snipaste 의 붙이기)
// 잘라낸 그림을 늘 위에 뜨는 작은 창으로 띄운다. 발표 기능과 부딪히지 않게 두 가지를 지킨다.
//  1) 핀은 발표 오버레이보다 위 레벨에 둔다. 확대·집중 모드에서도 가려지지 않는다.
//  2) 핀은 사용자의 화면 녹화에 담긴다(v0.36.3). 확대 화면 안에 겹쳐 그려지거나 스스로를
//     찍는 되먹임(v0.5.2 의 재캡처 증상)은 확대용 SCContentFilter 가 이 앱의 창을 빼서 막는다.
//     예전에는 창마다 sharingType = .none 을 걸어 막았는데, 그러면 녹화 영상에도 안 남았다.
enum Pin {
    static let edge: CGFloat = 3
    static let minSide: CGFloat = 40
    static let prefix = "다있쌤-핀-"
    static let maxCount = 12
    static let grip: CGFloat = 15
    static var level: NSWindow.Level { NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue+2) }
    static var snipLevel: NSWindow.Level { NSWindow.Level(rawValue: NSWindow.Level.screenSaver.rawValue+3) }
    static let lime = NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1)
    static let deep = NSColor(calibratedRed:0.06,green:0.20,blue:0.16,alpha:1)
    // 손가락 아이콘 대신 글자를 쓴다. 그림 파일을 따로 넣지 않기 위해서다.
    static let tools: [String] = ["✕","✎","⛶","⧉","⬇","↻"]
    static let cropTools: [String] = ["✓","✕"]
    // 회전·뒤집기를 화면 배율 그대로 유지하며 적용한다. lockFocus 로 그리면 1배로 떨어져 흐려진다.
    static func turned(_ image: NSImage, turns: Int, flipped: Bool) -> NSImage {
        guard turns != 0 || flipped else { return image }
        guard let cg=image.cgImage(forProposedRect:nil,context:nil,hints:nil) else { return image }
        let wide=cg.width, tall=cg.height
        let swapped = turns % 2 != 0
        let outWide = swapped ? tall : wide, outTall = swapped ? wide : tall
        guard let space=cg.colorSpace ?? CGColorSpace(name:CGColorSpace.sRGB),
              let ctx=CGContext(data:nil,width:outWide,height:outTall,bitsPerComponent:8,bytesPerRow:0,
                                space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { return image }
        ctx.interpolationQuality = .high
        ctx.translateBy(x:CGFloat(outWide)/2,y:CGFloat(outTall)/2)
        ctx.rotate(by: -CGFloat(turns)*(.pi/2))
        if flipped { ctx.scaleBy(x:-1,y:1) }
        ctx.draw(cg,in:CGRect(x:-CGFloat(wide)/2,y:-CGFloat(tall)/2,width:CGFloat(wide),height:CGFloat(tall)))
        guard let made=ctx.makeImage() else { return image }
        let size = swapped ? NSSize(width:image.size.height,height:image.size.width) : image.size
        return NSImage(cgImage:made,size:size)
    }
    // 잘라낼 때도 원래 픽셀을 그대로 가져온다.
    static func cut(_ image: NSImage, to area: NSRect) -> NSImage? {
        guard let cg=image.cgImage(forProposedRect:nil,context:nil,hints:nil), image.size.width>0, image.size.height>0 else { return nil }
        let factor=CGFloat(cg.width)/image.size.width
        // CGImage 는 원점이 왼쪽 위, 그림 좌표는 왼쪽 아래다.
        let pixels=CGRect(x:area.minX*factor,y:(image.size.height-area.maxY)*factor,
                          width:area.width*factor,height:area.height*factor).integral
        guard pixels.width>=1, pixels.height>=1, let piece=cg.cropping(to:pixels) else { return nil }
        return NSImage(cgImage:piece,size:NSSize(width:area.width,height:area.height))
    }
}
final class NoticeView: NSView {
    var text=""
    override var isOpaque: Bool { false }
    override func draw(_ dirtyRect: NSRect) {
        let box=NSBezierPath(roundedRect:bounds,xRadius:11,yRadius:11)
        Pin.deep.withAlphaComponent(0.93).setFill(); box.fill()
        Pin.lime.withAlphaComponent(0.85).setStroke(); box.lineWidth=1.5; box.stroke()
        let style=NSMutableParagraphStyle(); style.alignment = .center
        (text as NSString).draw(in:NSRect(x:10,y:bounds.midY-10,width:bounds.width-20,height:22),
            withAttributes:[.font:NSFont.boldSystemFont(ofSize:14),.foregroundColor:NSColor.white,.paragraphStyle:style])
    }
}
final class PinView: NSView {
    weak var owner: PinWindow?
    var hovering = false
    var note = ""
    var noteUntil: CFAbsoluteTime = 0
    override var isOpaque: Bool { false }
    override var acceptsFirstResponder: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        for area in trackingAreas { removeTrackingArea(area) }
        addTrackingArea(NSTrackingArea(rect:bounds,options:[.mouseEnteredAndExited,.activeAlways,.inVisibleRect],owner:self,userInfo:nil))
    }
    override func mouseEntered(with event: NSEvent) { hovering=true; needsDisplay=true }
    override func mouseExited(with event: NSEvent) { hovering=false; needsDisplay=true }
    var box: NSRect { bounds.insetBy(dx:Pin.edge,dy:Pin.edge) }
    var glyphs: [String] { owner?.cropping == true ? Pin.cropTools : Pin.tools }
    // 작은 핀에서는 단추가 다 들어가지 않는다. 들어가는 만큼만 그린다.
    func toolRects() -> [NSRect] {
        let side: CGFloat = 26, gap: CGFloat = 2
        let room = box.width - 6
        let fits = max(1, min(glyphs.count, Int((room+gap)/(side+gap))))
        let total = CGFloat(fits)*side + CGFloat(fits-1)*gap
        var x = max(Pin.edge, bounds.maxX-Pin.edge-total)
        let y = bounds.maxY-Pin.edge-side
        var boxes: [NSRect] = []
        for _ in 0..<fits { boxes.append(NSRect(x:x,y:y,width:side,height:side)); x += side+gap }
        return boxes
    }
    func flash(_ text: String) { note=text; noteUntil=CFAbsoluteTimeGetCurrent()+1.6; needsDisplay=true }
    override func draw(_ dirtyRect: NSRect) {
        guard let pin=owner else { return }
        let outline = NSBezierPath(roundedRect:box,xRadius:5,yRadius:5)
        if pin.folded {
            Pin.deep.withAlphaComponent(0.92).setFill(); outline.fill()
            " ▣ 접은 핀 · 두 번 눌러 펼치기 ".draw(at:NSPoint(x:box.minX+8,y:box.midY-8),
                withAttributes:[.font:NSFont.boldSystemFont(ofSize:12),.foregroundColor:NSColor.white])
        } else {
            NSGraphicsContext.saveGraphicsState()
            outline.addClip()
            NSColor.white.setFill(); box.fill()
            pin.shown.draw(in:box,from:.zero,operation:.sourceOver,fraction:1,respectFlipped:true,
                           hints:[.interpolation:NSImageInterpolation.high])
            pin.paintMarks(in:box)
            if pin.cropping { drawCrop(pin) }
            if pin.drawing { drawInk(pin) }
            NSGraphicsContext.restoreGraphicsState()
        }
        // 클릭 통과 중인 핀은 눌러도 반응하지 않는다. 테두리 색으로 그 사실을 계속 보여 준다.
        let border = pin.cropping ? Pin.lime
                   : pin.through ? NSColor(calibratedRed:0.99,green:0.71,blue:0.25,alpha:0.95)
                                 : Pin.lime.withAlphaComponent(0.95)
        border.setStroke(); outline.lineWidth=Pin.edge; outline.stroke()
        if (hovering || pin.cropping) && !pin.folded && !pin.through && !pin.drawing {
            let boxes=toolRects()
            for (index,rect) in boxes.enumerated() {
                let chip=NSBezierPath(roundedRect:rect,xRadius:5,yRadius:5)
                (index==0 && pin.cropping ? Pin.lime : Pin.deep.withAlphaComponent(0.86)).setFill(); chip.fill()
                let style=NSMutableParagraphStyle(); style.alignment = .center
                (glyphs[index] as NSString).draw(in:NSRect(x:rect.minX,y:rect.midY-9,width:rect.width,height:18),
                    withAttributes:[.font:NSFont.boldSystemFont(ofSize:13),
                                    .foregroundColor:(index==0 && pin.cropping ? Pin.deep : NSColor.white),
                                    .paragraphStyle:style])
            }
            let tip = pin.cropping ? " 모퉁이를 끌어 자를 부분을 정하세요 · Return 자르기 · Esc 취소 "
                                   : " 끌어서 이동 · 휠 크기 · ⌘휠 투명 · 오른쪽 클릭 메뉴 "
            tip.draw(at:NSPoint(x:box.minX+4,y:box.minY+4),
                     withAttributes:[.font:NSFont.systemFont(ofSize:11),.foregroundColor:NSColor.white,
                                     .backgroundColor:NSColor.black.withAlphaComponent(0.72)])
        }
        if !note.isEmpty && CFAbsoluteTimeGetCurrent() < noteUntil {
            (" "+note+" ").draw(at:NSPoint(x:box.minX+6,y:box.maxY-24),
                withAttributes:[.font:NSFont.boldSystemFont(ofSize:12),.foregroundColor:NSColor.white,
                                .backgroundColor:Pin.deep.withAlphaComponent(0.92)])
        }
    }
    func drawCrop(_ pin: PinWindow) {
        let area=pin.cropBox
        NSColor.black.withAlphaComponent(0.55).setFill()
        let outside=NSBezierPath(rect:box)
        outside.append(NSBezierPath(rect:area))
        outside.windingRule = .evenOdd
        outside.fill()
        outside.windingRule = .nonZero
        Pin.lime.setStroke()
        let frame=NSBezierPath(rect:area); frame.lineWidth=2; frame.stroke()
        // 삼등분 선. 무엇을 남길지 눈으로 잡기 쉬워진다.
        Pin.lime.withAlphaComponent(0.35).setStroke()
        let guides=NSBezierPath(); guides.lineWidth=1
        for step in 1...2 {
            let fx=area.minX+area.width*CGFloat(step)/3, fy=area.minY+area.height*CGFloat(step)/3
            guides.move(to:NSPoint(x:fx,y:area.minY)); guides.line(to:NSPoint(x:fx,y:area.maxY))
            guides.move(to:NSPoint(x:area.minX,y:fy)); guides.line(to:NSPoint(x:area.maxX,y:fy))
        }
        guides.stroke()
        for corner in pin.cropCorners() {
            Pin.lime.setFill(); NSBezierPath(roundedRect:corner,xRadius:3,yRadius:3).fill()
            Pin.deep.setStroke()
            let mark=NSBezierPath(roundedRect:corner,xRadius:3,yRadius:3); mark.lineWidth=1.5; mark.stroke()
        }
        let ratio=pin.shown.size.width/max(1,box.width)
        let label=" \(Int(area.width*ratio)) × \(Int(area.height*ratio)) "
        label.draw(at:NSPoint(x:area.minX+2,y:area.maxY+4>box.maxY-18 ? area.minY-18 : area.maxY+4),
                   withAttributes:[.font:NSFont.boldSystemFont(ofSize:11),.foregroundColor:Pin.deep,.backgroundColor:Pin.lime])
    }
    func drawInk(_ pin: PinWindow) {
        // 고쳐 쓰는 중인 글상자에는 테두리와 크기 손잡이를 보여 준다.
        if let frame=pin.chosenFrame(), pin.editor == nil {
            Pin.lime.setStroke()
            let edge=NSBezierPath(rect:frame); edge.lineWidth=1.5
            edge.setLineDash([4,3],count:2,phase:0); edge.stroke()
            for grip in pin.cornerGrips() {
                Pin.lime.setFill(); NSBezierPath(roundedRect:grip,xRadius:2,yRadius:2).fill()
                Pin.deep.setStroke()
                let ring=NSBezierPath(roundedRect:grip,xRadius:2,yRadius:2); ring.lineWidth=1; ring.stroke()
            }
            if let drop=pin.chosenDropGrip() {
                NSColor(calibratedRed:0.80,green:0.28,blue:0.22,alpha:1).setFill()
                NSBezierPath(roundedRect:drop,xRadius:3,yRadius:3).fill()
                let mark:[NSAttributedString.Key:Any]=[.font:NSFont.boldSystemFont(ofSize:9),.foregroundColor:NSColor.white]
                ("✕" as NSString).draw(at:NSPoint(x:drop.minX+3,y:drop.minY+1),withAttributes:mark)
            }
        }
        if pin.editor != nil {
            // 테두리는 그리지 않는다. 커서와 두 손잡이만으로 자리를 알 수 있다.
            if let grip=pin.sizeGrip() {
                Pin.lime.setFill(); NSBezierPath(roundedRect:grip,xRadius:3,yRadius:3).fill()
                let mark:[NSAttributedString.Key:Any]=[.font:NSFont.boldSystemFont(ofSize:9),.foregroundColor:Pin.deep]
                ("⇲" as NSString).draw(at:NSPoint(x:grip.minX+2,y:grip.minY+1),withAttributes:mark)
            }
            if let drop=pin.dropGrip() {
                NSColor(calibratedRed:0.80,green:0.28,blue:0.22,alpha:1).setFill()
                NSBezierPath(roundedRect:drop,xRadius:3,yRadius:3).fill()
                let mark:[NSAttributedString.Key:Any]=[.font:NSFont.boldSystemFont(ofSize:9),.foregroundColor:NSColor.white]
                ("✕" as NSString).draw(at:NSPoint(x:drop.minX+3,y:drop.minY+1),withAttributes:mark)
            }
        }

        let strip=NSRect(x:box.minX,y:box.minY,width:box.width,height:60)
        NSColor.black.withAlphaComponent(0.55).setFill(); strip.fill()
        let style=NSMutableParagraphStyle(); style.alignment = .center
        for (rect,act) in pin.inkHits() {
            var on=false, face=NSColor.white, back=NSColor.white.withAlphaComponent(0.16)
            var glyph="", isColor=false
            switch act {
            case .pick:
                on = pin.picking
                glyph="↖"
            case .tool(let kind):
                on = !pin.picking && pin.tool==kind
                glyph = Ink.tools.first(where:{$0.0==kind})?.1 ?? "?"
            case .color(let index):
                back=Ink.inks[index]; on = pin.inkIndex==index; isColor=true
            case .heft(let index):
                on = pin.heftIndex==index; glyph = ["·","•","●"][index]
            case .undo: glyph="↶"
            case .done: glyph="✓ 마침"; back=Pin.lime; face=Pin.deep
            case .cancel: glyph="⌫"
            }
            let chip=NSBezierPath(roundedRect:rect,xRadius:5,yRadius:5)
            // 색 칩은 색 자체가 보여야 한다. 고른 표시는 테두리로만 한다.
            (isColor || !on ? back : Pin.lime).setFill(); chip.fill()
            if on {
                if isColor {
                    NSColor.white.setStroke()
                    let inner=NSBezierPath(roundedRect:rect.insetBy(dx:2.5,dy:2.5),xRadius:4,yRadius:4)
                    inner.lineWidth=2; inner.stroke()
                }
                Pin.deep.setStroke(); chip.lineWidth=1.5; chip.stroke()
            }
            if !glyph.isEmpty {
                (glyph as NSString).draw(in:NSRect(x:rect.minX,y:rect.midY-8,width:rect.width,height:16),
                    withAttributes:[.font:NSFont.boldSystemFont(ofSize:glyph.count>2 ? 11 : 13),
                                    .foregroundColor:(on ? Pin.deep : face),.paragraphStyle:style])
            }
        }
    }
    override func mouseDown(with event: NSEvent) {
        guard let pin=owner else { return }
        // performDrag 는 창을 키 창으로 만들지 않는다. 그래서 핀을 눌러도 키보드가 이 핀으로 오지 않아
        // t·c·s·1·2·3·0·Space·Esc 가 전부 먹통이었다. 누르는 순간 키 창으로 삼는다.
        if !pin.isKeyWindow { pin.makeKeyAndOrderFront(nil) }
        let point=convert(event.locationInWindow,from:nil)
        if pin.drawing {
            // 그리는 중에도 옮길 수 있어야 한다. ⌘ 을 누른 채 끌면 그린 그대로 따라온다.
            if event.modifierFlags.contains(.command) { pin.performDrag(with:event); return }
            for (rect,act) in pin.inkHits() where rect.contains(point) { pin.inkTap(act); return }
            if pin.picking {
                // 고른 것의 모퉁이를 잡으면 크기, 안쪽을 잡으면 이동, 빈 곳이면 고르기 해제.
                for (corner,grip) in pin.cornerGrips().enumerated() where grip.contains(point) {
                    if let index=pin.chosen {
                        pin.stretching=(index:index,corner:corner,box:pin.markBox(pin.marks[index]))
                        return
                    }
                }
                if let drop=pin.chosenDropGrip(), drop.contains(point) { pin.dropChosen(); return }
                guard let index=pin.markHit(point) else { pin.chosen=nil; pin.canvas?.needsDisplay=true; return }
                pin.chosen=index
                pin.shifting=(index:index,grab:point,box:pin.markBox(pin.marks[index]))
                pin.canvas?.needsDisplay=true
                return
            }
            if let drop=pin.dropGrip(), drop.contains(point) { pin.dropEditing(); return }
            // 크기 손잡이를 끌면 글자가 커지고 작아진다.
            if let grip=pin.sizeGrip(), grip.contains(point), let index=pin.editing, index < pin.marks.count {
                pin.sizing=(index:index,grab:point,size:pin.marks[index].size); return
            }
            // 이미 쓴 글을 누르면 고쳐 쓰고, 끌면 옮긴다.
            if pin.tool == .text, var index=pin.textHit(point) {
                // 빈 글상자를 닫으면 그 표시가 지워져 뒤의 번호가 한 칸씩 당겨진다. 다시 찾는다.
                if pin.editing != index {
                    pin.closeEditor(keep:true)
                    guard let again=pin.textHit(point) else { pin.inkBegin(at:point); return }
                    index=again
                }
                pin.moving=(index:index,grab:point,from:pin.marks[index].from); return
            }
            pin.closeEditor(keep:true)
            pin.inkBegin(at:point); return
        }
        if (hovering || pin.cropping) && !pin.folded && !pin.through {
            for (index,rect) in toolRects().enumerated() where rect.contains(point) {
                if pin.cropping { index==0 ? pin.applyCrop() : pin.cancelCrop() }
                else {
                    switch index {
                    case 0: pin.close()
                    case 1: pin.beginDraw()
                    case 2: pin.beginCrop()
                    case 3: pin.copyOut()
                    case 4: pin.saveOut()
                    default: pin.rotate(1)
                    }
                }
                return
            }
        }
        if pin.cropping { pin.cropGrab(at:point); return }
        if event.clickCount >= 2 { pin.toggleFold(); return }
        pin.performDrag(with:event)
    }
    override func mouseDragged(with event: NSEvent) {
        guard let pin=owner else { return }
        let point=convert(event.locationInWindow,from:nil)
        if pin.drawing {
            if let job=pin.stretching {
                let here=pin.toImage(point)
                var box=job.box
                // 잡은 모퉁이의 맞은편은 고정. 0 왼아래 1 오른아래 2 왼위 3 오른위
                let fixedX = (job.corner==0 || job.corner==2) ? box.maxX : box.minX
                let fixedY = (job.corner==0 || job.corner==1) ? box.maxY : box.minY
                box=NSRect(x:min(fixedX,here.x),y:min(fixedY,here.y),
                           width:abs(here.x-fixedX),height:abs(here.y-fixedY))
                pin.stretchMark(job.index,from:pin.markBox(pin.marks[job.index]),to:box)
                pin.canvas?.needsDisplay=true; return
            }
            if let job=pin.shifting {
                let a=pin.toImage(job.grab), b=pin.toImage(point)
                pin.shiftMark(job.index,by:NSPoint(x:b.x-a.x,y:b.y-a.y))
                pin.shifting=(index:job.index,grab:point,box:job.box)
                pin.canvas?.needsDisplay=true; return
            }
            if let job=pin.sizing {
                // 오른쪽·아래로 끌수록 커진다.
                let step=(point.x-job.grab.x)-(point.y-job.grab.y)
                pin.setTextSize(job.index,to:job.size+step*0.6); return
            }
            if var job=pin.moving {
                let a=pin.toImage(job.grab), b=pin.toImage(point)
                if abs(point.x-job.grab.x)>2 || abs(point.y-job.grab.y)>2 { job.grab=job.grab; pin.moving=job }
                pin.moveText(job.index,to:NSPoint(x:job.from.x+b.x-a.x,y:job.from.y+b.y-a.y)); return
            }
            pin.inkMove(to:point); return
        }
        guard pin.cropping else { return }
        pin.cropMove(to:point)
    }
    override func mouseUp(with event: NSEvent) {
        guard let pin=owner else { return }
        let point=convert(event.locationInWindow,from:nil)
        if pin.drawing {
            if let job=pin.stretching {
                pin.stretching=nil; pin.remakeTile(job.index); return
            }
            if let job=pin.shifting {
                pin.shifting=nil; pin.remakeTile(job.index)
                // 글상자는 제자리에서 떼면 고쳐 쓰기로 들어간다.
                if abs(point.x-job.grab.x)<3, abs(point.y-job.grab.y)<3,
                   job.index < pin.marks.count, pin.marks[job.index].kind == .text {
                    pin.openEditor(job.index)
                }
                return
            }
            if pin.sizing != nil { pin.sizing=nil; return }
            if let job=pin.moving {
                pin.moving=nil
                // 제자리에서 뗐으면 옮긴 것이 아니라 고쳐 쓰겠다는 뜻이다.
                let still=abs(point.x-job.grab.x)<3 && abs(point.y-job.grab.y)<3
                if still && pin.editing != job.index { pin.openEditor(job.index) }
                return
            }
            pin.inkFinish(); return
        }
        pin.cropRelease()
    }
    override func rightMouseDown(with event: NSEvent) {
        guard let pin=owner, !pin.cropping, !pin.drawing else { return }
        NSMenu.popUpContextMenu(pin.buildMenu(),with:event,for:self)
    }
    override func scrollWheel(with event: NSEvent) {
        guard let pin=owner, !pin.cropping, !pin.drawing else { return }
        let step=event.scrollingDeltaY
        guard step != 0 else { return }
        if event.modifierFlags.contains(.command) { pin.setShade(pin.shade+(step>0 ? 0.06 : -0.06)) }
        else { pin.setZoom(pin.zoom*(step>0 ? 1.06 : 1/1.06)) }
    }
    override func keyDown(with event: NSEvent) {
        guard let pin=owner else { return }
        if pin.drawing {
            // 글상자가 열려 있으면 키는 글상자 것이다. 여기까지 오지도 않는다.
            if pin.editing != nil { super.keyDown(with:event); return }
            // 고른 것이 있으면 Delete 로 지운다.
            if pin.picking, pin.chosen != nil, event.keyCode==51 || event.keyCode==117 {
                pin.dropChosen(); return
            }
            switch event.keyCode {
            // 나가는 길은 모두 '그린 것을 남기고' 나간다. 그래야 그대로 옮길 수 있다.
            case 36,76,53: pin.endDraw(keep:true)     // Return · Enter · Esc
            case 6: if !pin.marks.isEmpty { pin.marks.removeLast() }   // z 되돌리기
            case 35: pin.tool = .pen                  // p
            case 31: pin.tool = .ellipse              // o
            case 37: pin.tool = .line                 // l
            case 46: pin.tool = .mosaic               // m
            case 17: pin.tool = .text                 // t
            default: super.keyDown(with:event)
            }
            pin.canvas?.needsDisplay=true
            return
        }
        if pin.cropping {
            switch event.keyCode {
            case 36,76: pin.applyCrop()       // Return · Enter
            case 53: pin.cancelCrop()         // Esc
            default: super.keyDown(with:event)
            }
            return
        }
        switch event.keyCode {
        case 53: pin.close()                      // Esc
        case 49: pin.toggleFold()                 // Space
        case 18: pin.rotate(-1)                   // 1
        case 19: pin.rotate(1)                    // 2
        case 20: pin.flipped = !pin.flipped; pin.rebuild()   // 3
        case 29: pin.reset()                      // 0
        case 8: pin.copyOut()                     // c
        case 1: pin.saveOut()                     // s
        case 17: pin.setThrough(true)             // t
        case 7: pin.beginCrop()                   // x
        case 2: pin.beginDraw()                   // d
        default: super.keyDown(with:event)
        }
    }
}
// 예전에는 keyDown 의 event.characters 를 그대로 붙여 글자를 만들었다. 한글·일본어·중국어는
// 그 방식으로는 조합이 되지 않는다. macOS 는 자모를 하나씩 따로 주기 때문에 '가' 가 'ㄱㅏ' 로
// 남았고, Windows 는 조합 중인 글자에 WM_CHAR 를 주지 않아 아예 한 글자도 들어가지 않았다.
// 이제 진짜 글상자를 얹는다. 조합도 줄바꿈도 되돌리기도 운영체제가 해 준다.
final class InkText: NSTextView {
    weak var pin: PinWindow?
    override func keyDown(with event: NSEvent) {
        // Esc 로 끝낸다. Return 은 줄바꿈이어야 하므로 여기서 가로채지 않는다.
        if event.keyCode == 53 { pin?.closeEditor(keep:true); return }
        super.keyDown(with:event)
    }
    override func didChangeText() {
        super.didChangeText()
        pin?.editorGrew()
    }
}

final class PinWindow: NSPanel {
    var source: NSImage
    // 회전·뒤집기를 미리 적용해 둔 그림. 화면에 그리는 것도 자르는 것도 모두 이것을 기준으로 한다.
    var shown: NSImage
    weak var host: Presenter?
    var zoom: CGFloat = 1
    var turns = 0
    var flipped = false
    var shade: CGFloat = 1
    var through = false
    var folded = false
    var cropping = false
    var cropBox = NSRect.zero
    var grabbed = -1            // -1 없음, 0~3 모퉁이, 4 안쪽 이동, 5 새로 그리기
    // 조각 위에 그리기
    var drawing = false
    var marks: [Mark] = []
    var live: Mark? = nil
    var typing: Int? = nil        // 남겨 둔다: 옛 흐름이 참조한다
    var editor: InkText? = nil
    var editing: Int? = nil       // 지금 고쳐 쓰는 글상자
    var textTop = NSPoint.zero    // 글상자의 왼쪽 위 (화면 좌표). 줄이 늘면 아래로 자란다.
    var moving: (index:Int, grab:NSPoint, from:NSPoint)? = nil
    // 고르기. 이미 그린 것을 눌러 고르고, 끌어 옮기고, 모퉁이로 크기를 바꾸고, 지운다.
    var picking = false
    var chosen: Int? = nil
    var shifting: (index:Int, grab:NSPoint, box:NSRect)? = nil
    var stretching: (index:Int, corner:Int, box:NSRect)? = nil
    var sizing: (index:Int, grab:NSPoint, size:CGFloat)? = nil
    var tool: Mark.Kind = .pen
    var inkIndex = 0
    var heftIndex = 1
    var grabFrom = NSPoint.zero
    var grabBox = NSRect.zero
    init(image: NSImage, host: Presenter, centre: NSPoint) {
        self.source=image; self.shown=image; self.host=host
        super.init(contentRect:NSRect(x:0,y:0,width:80,height:60),styleMask:[.borderless,.nonactivatingPanel],backing:.buffered,defer:false)
        isOpaque=false; backgroundColor = .clear; hasShadow=true
        // sharingType 은 건드리지 않는다 — 핀은 **화면 녹화에 담겨야 한다**(사용자 보고).
        // 확대 화면에 겹쳐 그려지는 일은 SCContentFilter 가 이 앱을 빼는 것으로 막는다.
        collectionBehavior=[.canJoinAllSpaces,.fullScreenAuxiliary,.stationary]
        hidesOnDeactivate=false; isMovableByWindowBackground=false; isFloatingPanel=true
        // isFloatingPanel 을 켜면 창 레벨이 floating 으로 되돌아간다. 그러면 발표 오버레이
        // (screenSaver) 보다 아래로 내려가 확대 중에 핀이 가려진다. 레벨은 반드시 그 뒤에 정한다.
        level=Pin.level
        // 닫을 때 AppKit 이 바로 해제하면 메뉴가 잡고 있는 사이에 사라질 수 있다. ARC 에 맡긴다.
        isReleasedWhenClosed=false
        let canvas=PinView(frame:NSRect(x:0,y:0,width:80,height:60)); canvas.owner=self; contentView=canvas
        // 화면보다 큰 조각은 처음부터 줄여서 띄운다.
        if let screen=NSScreen.screens.first(where:{$0.frame.contains(centre)}) ?? NSScreen.main {
            let room=screen.visibleFrame.insetBy(dx:24,dy:24)
            zoom=min(1,min(room.width/max(1,image.size.width),room.height/max(1,image.size.height)))
        }
        layout(centre:centre)
    }
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    var canvas: PinView? { contentView as? PinView }
    var natural: NSSize { shown.size }
    func rebuild() {
        shown=Pin.turned(source,turns:turns,flipped:flipped)
        refresh()
    }
    func layout(centre: NSPoint? = nil) {
        let wide=max(Pin.minSide,natural.width*zoom)+Pin.edge*2
        let tall=max(Pin.minSide,natural.height*zoom)+Pin.edge*2
        let size=folded ? NSSize(width:220,height:32) : NSSize(width:wide,height:tall)
        let middle=centre ?? NSPoint(x:frame.midX,y:frame.midY)
        var next=NSRect(x:round(middle.x-size.width/2),y:round(middle.y-size.height/2),width:round(size.width),height:round(size.height))
        // 핀이 화면 밖으로 완전히 나가면 다시 잡을 수 없다. 늘 일부는 보이게 끌어 둔다.
        if let screen=NSScreen.screens.first(where:{$0.frame.intersects(next)}) ?? NSScreen.main {
            let room=screen.visibleFrame
            next.origin.x=min(max(next.origin.x,room.minX-next.width+60),room.maxX-60)
            next.origin.y=min(max(next.origin.y,room.minY-next.height+60),room.maxY-40)
        }
        setFrame(next,display:true)
        canvas?.frame=NSRect(origin:.zero,size:next.size)
        canvas?.needsDisplay=true
    }
    func refresh() { layout(); canvas?.needsDisplay=true }
    func setZoom(_ wanted: CGFloat) {
        let room=(NSScreen.screens.first(where:{$0.frame.intersects(frame)}) ?? NSScreen.main)?.visibleFrame.size ?? NSSize(width:1200,height:800)
        let biggest=min(6,max(1,min(room.width/max(1,natural.width),room.height/max(1,natural.height))))
        let smallest=Pin.minSide/max(natural.width,natural.height)
        zoom=max(smallest,min(biggest,wanted)); refresh()
    }
    func setShade(_ wanted: CGFloat) { shade=max(0.25,min(1,wanted)); alphaValue=shade; canvas?.flash(String(format:"불투명 %.0f%%",Double(shade*100))) }
    func rotate(_ step: Int) { turns=((turns+step) % 4 + 4) % 4; rebuild() }
    func reset() { zoom=1; turns=0; flipped=false; setShade(1); setThrough(false); folded=false; cropping=false; rebuild() }
    func toggleFold() { if cropping || drawing { return }; folded = !folded; refresh() }
    func setThrough(_ wanted: Bool) {
        through=wanted; ignoresMouseEvents=wanted
        // 통과를 켜면 이 핀은 더 이상 클릭을 받지 않는다. 되돌리는 길을 반드시 알려 준다.
        if wanted { cropping=false; drawing=false; marks=[]; canvas?.flash("클릭 통과 켜짐 · 휠로 투명도 · 사이드바나 메뉴에서 해제") }
        canvas?.needsDisplay=true
        // 핀에서 직접 켜고 끈 것도 사이드바 셈과 휠 가로채기에 반영되어야 한다.
        host?.publishState()
    }
    // MARK: 모퉁이로 잘라내기
    func beginCrop() {
        guard !through, !folded, !drawing else { return }
        cropping=true
        cropBox=(canvas?.box ?? .zero).insetBy(dx:0,dy:0)
        grabbed = -1
        makeKeyAndOrderFront(nil)
        canvas?.needsDisplay=true
    }
    func cancelCrop() { cropping=false; grabbed = -1; canvas?.needsDisplay=true }
    func cropCorners() -> [NSRect] {
        let g=Pin.grip, a=cropBox
        return [NSRect(x:a.minX-g/2,y:a.minY-g/2,width:g,height:g),   // 0 왼쪽 아래
                NSRect(x:a.maxX-g/2,y:a.minY-g/2,width:g,height:g),   // 1 오른쪽 아래
                NSRect(x:a.maxX-g/2,y:a.maxY-g/2,width:g,height:g),   // 2 오른쪽 위
                NSRect(x:a.minX-g/2,y:a.maxY-g/2,width:g,height:g)]   // 3 왼쪽 위
    }
    func cropGrab(at point: NSPoint) {
        grabFrom=point; grabBox=cropBox
        for (index,corner) in cropCorners().enumerated() where corner.contains(point) { grabbed=index; return }
        if cropBox.contains(point) { grabbed=4; return }
        // 바깥을 끌면 그 자리에서 새로 잡는다.
        grabbed=5; cropBox=NSRect(origin:point,size:.zero)
    }
    func cropMove(to point: NSPoint) {
        guard grabbed >= 0, let limit=canvas?.box else { return }
        let x=min(max(point.x,limit.minX),limit.maxX), y=min(max(point.y,limit.minY),limit.maxY)
        var next=cropBox
        switch grabbed {
        case 0: next=NSRect(x:x,y:y,width:grabBox.maxX-x,height:grabBox.maxY-y)
        case 1: next=NSRect(x:grabBox.minX,y:y,width:x-grabBox.minX,height:grabBox.maxY-y)
        case 2: next=NSRect(x:grabBox.minX,y:grabBox.minY,width:x-grabBox.minX,height:y-grabBox.minY)
        case 3: next=NSRect(x:x,y:grabBox.minY,width:grabBox.maxX-x,height:y-grabBox.minY)
        case 4:
            let dx=x-grabFrom.x, dy=y-grabFrom.y
            next=grabBox.offsetBy(dx:dx,dy:dy)
            next.origin.x=min(max(next.minX,limit.minX),limit.maxX-next.width)
            next.origin.y=min(max(next.minY,limit.minY),limit.maxY-next.height)
        default:
            next=NSRect(x:min(grabFrom.x,x),y:min(grabFrom.y,y),width:abs(x-grabFrom.x),height:abs(y-grabFrom.y))
        }
        // 뒤집힌 사각형은 정상 방향으로 되돌린다.
        if next.width < 0 { next=NSRect(x:next.maxX,y:next.minY,width:-next.width,height:next.height) }
        if next.height < 0 { next=NSRect(x:next.minX,y:next.maxY,width:next.width,height:-next.height) }
        cropBox=next.intersection(limit)
        canvas?.needsDisplay=true
    }
    func cropRelease() { grabbed = -1 }
    func applyCrop() {
        guard cropping, let limit=canvas?.box else { return }
        let area=cropBox.intersection(limit)
        guard area.width >= 10, area.height >= 10 else { canvas?.flash("자를 부분이 너무 작습니다"); return }
        // 화면 상자 좌표를 그림 좌표로 옮긴다.
        let across=shown.size.width/max(1,limit.width), down=shown.size.height/max(1,limit.height)
        let inImage=NSRect(x:(area.minX-limit.minX)*across,y:(area.minY-limit.minY)*down,
                           width:area.width*across,height:area.height*down)
        guard let piece=Pin.cut(shown,to:inImage) else { canvas?.flash("자르지 못했습니다"); return }
        // 자른 결과가 새 원본이 된다. 회전은 이미 반영되어 있으므로 되돌린다.
        source=piece; turns=0; flipped=false; cropping=false; grabbed = -1
        rebuild()
        canvas?.flash("잘랐습니다 · \(Int(inImage.width))×\(Int(inImage.height))")
    }
    func copyOut() {
        let board=NSPasteboard.general
        board.clearContents(); board.writeObjects([shown])
        canvas?.flash("클립보드에 복사")
    }
    func saveOut() {
        if let name=Presenter.savePin(shown) { canvas?.flash(Shots.name+" · "+name) }
        else { canvas?.flash("저장하지 못했습니다") }
    }
    func buildMenu() -> NSMenu {
        let menu=NSMenu()
        func add(_ title: String,_ action: @escaping ()->Void,_ mark: Bool = false) {
            let item=NSMenuItem(title:title,action:#selector(MenuAction.fire(_:)),keyEquivalent:"")
            let box=MenuAction(action); item.target=box; item.representedObject=box; item.state = mark ? .on : .off
            menu.addItem(item)
        }
        add("그리기 · 표시하기 (d)") { [weak self] in self?.beginDraw() }
        add("모퉁이로 잘라내기 (x)") { [weak self] in self?.beginCrop() }
        menu.addItem(.separator())
        add("복사 (c)") { [weak self] in self?.copyOut() }
        add("캐퍼이미지 폴더에 저장 (s)") { [weak self] in self?.saveOut() }
        menu.addItem(.separator())
        add("왼쪽으로 회전 (1)") { [weak self] in self?.rotate(-1) }
        add("오른쪽으로 회전 (2)") { [weak self] in self?.rotate(1) }
        add("좌우 뒤집기 (3)") { [weak self] in guard let me=self else { return }; me.flipped = !me.flipped; me.rebuild() }
        add("크기·투명도 원래대로 (0)") { [weak self] in self?.reset() }
        menu.addItem(.separator())
        add("접기·펼치기 (Space)",{ [weak self] in self?.toggleFold() },folded)
        add("클릭 통과 (t)",{ [weak self] in self?.setThrough(true) },through)
        menu.addItem(.separator())
        add("이 핀 닫기 (Esc)") { [weak self] in self?.close() }
        add("모든 핀 닫기") { [weak self] in self?.host?.clearPins() }
        return menu
    }
    override func close() {
        host?.forget(self)
        orderOut(nil)
        super.close()
    }
}
// MARK: 조각 위에 그리기
// 표시는 그림 좌표(shown 기준)로 담는다. 그래야 핀을 키우거나 줄여도 같은 자리에 남고,
// 굽기(flatten)할 때 그대로 그려 넣을 수 있다.
struct Mark {
    enum Kind { case pen, ellipse, line, mosaic, text }
    var kind: Kind
    var points: [NSPoint] = []
    var from = NSPoint.zero
    var to = NSPoint.zero
    var color: NSColor = .red
    var width: CGFloat = 5
    var size: CGFloat = 24
    var text = ""
    // 글자마다의 색. 비어 있으면 전부 color 를 쓴다. 블록을 골라 색을 바꾸면 여기에 담긴다.
    var tints: [NSColor] = []
    var tile: NSImage? = nil          // 모자이크용으로 미리 잘게 부숴 둔 조각
    var box: NSRect {
        NSRect(x:min(from.x,to.x),y:min(from.y,to.y),width:abs(to.x-from.x),height:abs(to.y-from.y))
    }
}
enum Ink {
    case tool(Mark.Kind), pick, color(Int), heft(Int), undo, done, cancel
    // 마지막 한 칸은 팔레트에서 직접 고른 색이다. 누르면 색 고르개가 열린다.
    static let customIndex = 6
    static var custom = NSColor(calibratedRed:0.60,green:0.30,blue:0.85,alpha:1)
    static var inks: [NSColor] { fixed + [custom] }
    static let fixed: [NSColor] = [
        NSColor(calibratedRed:0.85,green:0.19,blue:0.15,alpha:1),
        NSColor(calibratedRed:0.98,green:0.76,blue:0.16,alpha:1),
        NSColor(calibratedRed:0.22,green:0.66,blue:0.34,alpha:1),
        NSColor(calibratedRed:0.15,green:0.45,blue:0.86,alpha:1),
        NSColor(calibratedWhite:0.09,alpha:1),
        NSColor.white
    ]

    // 굵기와 글자 크기를 한 손잡이로 함께 움직인다.
    static let hefts: [(CGFloat,CGFloat)] = [(2,15),(5,24),(11,40)]
    static let tools: [(Mark.Kind,String)] = [(.pen,"✎"),(.ellipse,"○"),(.line,"▁"),(.mosaic,"▦"),(.text,"T")]
}
extension PinWindow {
    var inkBox: NSRect { canvas?.box ?? .zero }
    // 그림 좌표 ↔ 화면 상자 좌표
    func toImage(_ point: NSPoint) -> NSPoint {
        let box=inkBox
        guard box.width>0, box.height>0 else { return .zero }
        return NSPoint(x:(point.x-box.minX)*shown.size.width/box.width,
                       y:(point.y-box.minY)*shown.size.height/box.height)
    }
    func beginDraw() {
        guard !through, !folded, !cropping else { return }
        drawing=true; live=nil; typing=nil; editing=nil; moving=nil; sizing=nil
        picking=false; chosen=nil; shifting=nil; stretching=nil
        // 도구 줄이 들어갈 만큼은 넓혀 둔다.
        // 도구 줄과 색 줄이 모두 들어가는 폭. 색 칸이 7개가 되어 250 으로는 ⌫ 가 잘린다.
        if inkBox.width < 300 { setZoom(zoom*300/max(1,inkBox.width)) }
        makeKeyAndOrderFront(nil)
        canvas?.flash("↖ 고르기로 다시 옮기고 지웁니다 · ⌘ 끌기로 핀 이동 · Esc 나 Return 으로 마침")
        canvas?.needsDisplay=true
    }
    func endDraw(keep: Bool) {
        closeEditor(keep:keep)
        typing=nil; live=nil; moving=nil; sizing=nil
        picking=false; chosen=nil; shifting=nil; stretching=nil
        if keep, !marks.isEmpty, let flat=flatten() {
            // 그린 것까지 그림 자체에 굽는다. 이제 복사·저장·자르기 모두 그대로 따라온다.
            source=flat; turns=0; flipped=false; marks=[]
            drawing=false
            rebuild()
            canvas?.flash("그린 내용을 그림에 넣었습니다")
            return
        }
        marks=[]; drawing=false; canvas?.needsDisplay=true
    }
    func flatten() -> NSImage? {
        guard let cg=shown.cgImage(forProposedRect:nil,context:nil,hints:nil) else { return nil }
        guard let rep=NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:cg.width,pixelsHigh:cg.height,
                bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,
                colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0) else { return nil }
        rep.size=shown.size                       // 픽셀은 그대로 두고 좌표만 포인트로 맞춘다
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current=NSGraphicsContext(bitmapImageRep:rep)
        let whole=NSRect(origin:.zero,size:shown.size)
        shown.draw(in:whole,from:.zero,operation:.copy,fraction:1)
        paintMarks(in:whole)
        NSGraphicsContext.restoreGraphicsState()
        let made=NSImage(size:shown.size); made.addRepresentation(rep); return made
    }
    // 화면에도 굽기에도 같은 코드를 쓴다. box 가 그림 전체를 어디에 그리는지를 정한다.
    // 글자 속성은 화면·굽기·자리 재기 모두 한 곳에서 만든다. 셋이 어긋나면 글상자가 밀린다.
    static func textAttrs(_ mark: Mark, scale: CGFloat, pen: NSColor) -> [NSAttributedString.Key:Any] {
        [.font:NSFont.boldSystemFont(ofSize:max(6,mark.size*scale)),.foregroundColor:pen,
         .strokeColor:NSColor(calibratedWhite:0,alpha:0.55),.strokeWidth:-2.0]
    }
    // 글자마다 색이 다를 수 있으므로 속성 글로 만들어 한 번에 그린다. 줄바꿈·줄간격은
    // AppKit 이 알아서 맞춘다. 화면·굽기·자리 재기·글상자가 모두 이 하나를 쓴다.
    static func attributed(_ mark: Mark, scale: CGFloat) -> NSAttributedString {
        let body = mark.text.isEmpty ? " " : mark.text
        let made = NSMutableAttributedString(string:body,attributes:textAttrs(mark,scale:scale,pen:mark.color))
        let units = (body as NSString).length
        for i in 0..<min(units,mark.tints.count) {
            made.addAttribute(.foregroundColor,value:mark.tints[i],range:NSRange(location:i,length:1))
        }
        return made
    }
    func paintMarks(in box: NSRect) {
        guard shown.size.width>0, shown.size.height>0 else { return }
        let sx=box.width/shown.size.width, sy=box.height/shown.size.height
        func P(_ p: NSPoint) -> NSPoint { NSPoint(x:box.minX+p.x*sx,y:box.minY+p.y*sy) }
        func R(_ r: NSRect) -> NSRect { NSRect(x:box.minX+r.minX*sx,y:box.minY+r.minY*sy,width:r.width*sx,height:r.height*sy) }
        for (index,mark) in (marks + (live.map{[$0]} ?? [])).enumerated() {
            let pen=mark.color
            let thick=max(0.5,mark.width*sx)
            switch mark.kind {
            case .pen:
                guard mark.points.count>1 else { break }
                let path=NSBezierPath(); path.lineWidth=thick; path.lineCapStyle = .round; path.lineJoinStyle = .round
                path.move(to:P(mark.points[0]))
                for point in mark.points.dropFirst() { path.line(to:P(point)) }
                pen.setStroke(); path.stroke()
            case .ellipse:
                let path=NSBezierPath(ovalIn:R(mark.box)); path.lineWidth=thick
                pen.setStroke(); path.stroke()
            case .line:
                let path=NSBezierPath(); path.lineWidth=thick; path.lineCapStyle = .round
                path.move(to:P(mark.from)); path.line(to:P(mark.to))
                pen.setStroke(); path.stroke()
            case .mosaic:
                let area=R(mark.box)
                if let tile=mark.tile {
                    NSGraphicsContext.current?.imageInterpolation = .none
                    tile.draw(in:area,from:.zero,operation:.copy,fraction:1)
                    NSGraphicsContext.current?.imageInterpolation = .high
                } else {
                    NSColor(calibratedWhite:0.5,alpha:0.55).setFill(); area.fill()
                    pen.withAlphaComponent(0.9).setStroke()
                    let edge=NSBezierPath(rect:area); edge.lineWidth=1; edge.stroke()
                }
            case .text:
                guard !mark.text.isEmpty else { break }
                // 고쳐 쓰는 중인 글상자는 진짜 글상자가 대신 보여 준다. 두 겹으로 보이면 안 된다.
                if let busy=editing, busy==index { break }
                PinWindow.attributed(mark,scale:sx).draw(at:P(mark.from))
            }
        }
    }
    // 모자이크는 그 자리 픽셀을 잘게 부숴 미리 만들어 둔다. 그리기는 그 다음부터 가볍다.
    func mosaicTile(_ area: NSRect) -> NSImage? {
        guard area.width>=4, area.height>=4, let piece=Pin.cut(shown,to:area),
              let cg=piece.cgImage(forProposedRect:nil,context:nil,hints:nil) else { return nil }
        let wide=max(2,cg.width/14), tall=max(2,cg.height/14)
        guard let space=cg.colorSpace ?? CGColorSpace(name:CGColorSpace.sRGB),
              let small=CGContext(data:nil,width:wide,height:tall,bitsPerComponent:8,bytesPerRow:0,
                                  space:space,bitmapInfo:CGImageAlphaInfo.premultipliedLast.rawValue) else { return nil }
        small.interpolationQuality = .medium
        small.draw(cg,in:CGRect(x:0,y:0,width:wide,height:tall))
        guard let made=small.makeImage() else { return nil }
        return NSImage(cgImage:made,size:area.size)
    }
    // 그리기 도구 줄. 아래 두 줄에 붙인다.
    func inkHits() -> [(NSRect,Ink)] {
        let box=inkBox
        var out:[(NSRect,Ink)]=[]
        let big: CGFloat=24, small: CGFloat=20, gap: CGFloat=3
        // 마침 단추는 글자를 넣어 넓게 둔다. 되돌리기 바로 옆이라 눈에 걸린다.
        let wide: CGFloat=52
        var x=box.minX+4
        let top=box.minY+4+small+gap
        out.append((NSRect(x:x,y:top,width:big,height:big),.pick)); x+=big+gap
        for (kind,_) in Ink.tools { out.append((NSRect(x:x,y:top,width:big,height:big),.tool(kind))); x+=big+gap }
        x+=6
        out.append((NSRect(x:x,y:top,width:big,height:big),.undo)); x+=big+gap
        out.append((NSRect(x:x,y:top,width:wide,height:big),.done)); x+=wide+gap
        out.append((NSRect(x:x,y:top,width:big,height:big),.cancel))
        x=box.minX+4
        let low=box.minY+4
        for index in Ink.inks.indices { out.append((NSRect(x:x,y:low,width:small,height:small),.color(index))); x+=small+gap }
        x+=6
        for index in Ink.hefts.indices { out.append((NSRect(x:x,y:low,width:small,height:small),.heft(index))); x+=small+gap }
        return out
    }
    func inkTap(_ hit: Ink) {
        switch hit {
        case .tool(let kind): tool=kind; picking=false; chosen=nil
        case .pick: picking=true; chosen=nil; closeEditor(keep:true); canvas?.flash("그린 것을 눌러 고르고 · 끌어 옮기고 · 모퉁이로 크기 · Delete 로 지웁니다")
        case .color(let index):
            inkIndex=index
            // 마지막 칸은 색 고르개다. 이미 고른 상태에서 다시 누르면 고르개가 열린다.
            if index == Ink.customIndex { openPalette(); return }
            paintSelection(Ink.inks[index])
        case .heft(let index): heftIndex=index
        case .undo: if !marks.isEmpty { marks.removeLast() }
        case .done: endDraw(keep:true); return
        case .cancel:                              // 모두 지우기. 그리기에서 나가지는 않는다.
            marks=[]; live=nil; typing=nil
            canvas?.flash("그린 것을 모두 지웠습니다")
        }
        canvas?.needsDisplay=true
    }
    // ── 글상자 ────────────────────────────────────────────────────────────
    // 글 덩어리의 크기를 화면 좌표로 잰다. 그리는 것도 이 자리를 쓰므로 둘이 어긋나지 않는다.
    func textSize(_ mark: Mark, scale: CGFloat) -> NSSize {
        var size=PinWindow.attributed(mark,scale:scale).size()
        size.width=max(size.width,12); size.height=max(size.height,12)
        return size
    }
    // 그림 좌표에서 글이 차지하는 네모. 눌러서 고르는 데 쓴다.
    func textBox(_ mark: Mark) -> NSRect {
        let box=inkBox
        guard box.width>0, shown.size.width>0 else { return .zero }
        let sx=box.width/shown.size.width, sy=box.height/shown.size.height
        let size=textSize(mark,scale:sx)
        return NSRect(x:mark.from.x,y:mark.from.y,width:size.width/max(sx,0.0001),height:size.height/max(sy,0.0001))
    }
    // 표시 하나가 그림 안에서 차지하는 네모. 고르고 옮기고 크기를 바꾸는 바탕이다.
    func markBox(_ mark: Mark) -> NSRect {
        switch mark.kind {
        case .text: return textBox(mark)
        case .pen:
            guard let first=mark.points.first else { return .zero }
            var box=NSRect(origin:first,size:.zero)
            for point in mark.points.dropFirst() {
                box=NSRect(x:min(box.minX,point.x),y:min(box.minY,point.y),
                           width:max(box.maxX,point.x)-min(box.minX,point.x),
                           height:max(box.maxY,point.y)-min(box.minY,point.y))
            }
            return box.insetBy(dx:-mark.width,dy:-mark.width)
        default: return mark.box.insetBy(dx:-max(2,mark.width/2),dy:-max(2,mark.width/2))
        }
    }
    func markHit(_ point: NSPoint) -> Int? {
        let here=toImage(point)
        for index in marks.indices.reversed() {
            if markBox(marks[index]).insetBy(dx:-6,dy:-6).contains(here) { return index }
        }
        return nil
    }
    // 고른 표시의 네 모퉁이 손잡이 (화면 좌표)
    func cornerGrips() -> [NSRect] {
        guard let index=chosen, index < marks.count else { return [] }
        let box=inkBox
        guard box.width>0, shown.size.width>0 else { return [] }
        let sx=box.width/shown.size.width, sy=box.height/shown.size.height
        let r=markBox(marks[index])
        let view=NSRect(x:box.minX+r.minX*sx,y:box.minY+r.minY*sy,width:r.width*sx,height:r.height*sy)
        let g: CGFloat=11
        return [NSRect(x:view.minX-g/2,y:view.minY-g/2,width:g,height:g),
                NSRect(x:view.maxX-g/2,y:view.minY-g/2,width:g,height:g),
                NSRect(x:view.minX-g/2,y:view.maxY-g/2,width:g,height:g),
                NSRect(x:view.maxX-g/2,y:view.maxY-g/2,width:g,height:g)]
    }
    func chosenFrame() -> NSRect? {
        guard let index=chosen, index < marks.count else { return nil }
        let box=inkBox
        guard box.width>0, shown.size.width>0 else { return nil }
        let sx=box.width/shown.size.width, sy=box.height/shown.size.height
        let r=markBox(marks[index])
        return NSRect(x:box.minX+r.minX*sx,y:box.minY+r.minY*sy,width:r.width*sx,height:r.height*sy)
    }
    // 고른 표시의 오른쪽 위 지우기 손잡이
    func chosenDropGrip() -> NSRect? {
        guard let frame=chosenFrame() else { return nil }
        return NSRect(x:frame.maxX-2,y:frame.maxY-2,width:14,height:14)
    }
    // 모자이크는 그 자리 픽셀로 미리 만들어 둔 조각이다. 옮기거나 늘렸으면 다시 만든다.
    func remakeTile(_ index: Int) {
        guard index < marks.count, marks[index].kind == .mosaic else { return }
        marks[index].tile=mosaicTile(marks[index].box)
        canvas?.needsDisplay=true
    }
    func dropChosen() {
        guard let index=chosen, index < marks.count else { return }
        marks.remove(at:index); chosen=nil
        canvas?.flash("고른 것을 지웠습니다")
        canvas?.needsDisplay=true
    }
    // 표시를 통째로 옮긴다.
    func shiftMark(_ index: Int, by delta: NSPoint) {
        guard index < marks.count else { return }
        marks[index].from=NSPoint(x:marks[index].from.x+delta.x,y:marks[index].from.y+delta.y)
        marks[index].to=NSPoint(x:marks[index].to.x+delta.x,y:marks[index].to.y+delta.y)
        for i in marks[index].points.indices {
            marks[index].points[i]=NSPoint(x:marks[index].points[i].x+delta.x,y:marks[index].points[i].y+delta.y)
        }
    }
    // 네모를 새로 정해 그 안에 맞춰 늘린다. 모자이크는 자리를 옮겼으니 조각을 다시 만든다.
    func stretchMark(_ index: Int, from old: NSRect, to fresh: NSRect) {
        guard index < marks.count, old.width>1, old.height>1, fresh.width>2, fresh.height>2 else { return }
        let fx=fresh.width/old.width, fy=fresh.height/old.height
        func map(_ p: NSPoint) -> NSPoint {
            NSPoint(x:fresh.minX+(p.x-old.minX)*fx,y:fresh.minY+(p.y-old.minY)*fy)
        }
        marks[index].from=map(marks[index].from)
        marks[index].to=map(marks[index].to)
        for i in marks[index].points.indices { marks[index].points[i]=map(marks[index].points[i]) }
        if marks[index].kind == .text { marks[index].size=max(8,min(200,marks[index].size*fy)) }
        else { marks[index].width=max(1,min(60,marks[index].width*max(fx,fy))) }
    }
    func textHit(_ point: NSPoint) -> Int? {
        let here=toImage(point)
        for index in marks.indices.reversed() where marks[index].kind == .text {
            if textBox(marks[index]).insetBy(dx:-6,dy:-6).contains(here) { return index }
        }
        return nil
    }
    // 크기 손잡이. 고쳐 쓰는 중인 글상자의 오른쪽 아래에 붙는다.
    func sizeGrip() -> NSRect? {
        guard let view=editor else { return nil }
        let frame=view.frame
        return NSRect(x:frame.maxX-2,y:frame.minY-12,width:14,height:14)
    }
    // 지우기 손잡이. 오른쪽 위. 고르고 있는 이 글상자만 지운다.
    func dropGrip() -> NSRect? {
        guard let view=editor else { return nil }
        let frame=view.frame
        return NSRect(x:frame.maxX-2,y:frame.maxY-2,width:14,height:14)
    }
    func dropEditing() {
        guard let view=editor, let index=editing else { return }
        editor=nil; editing=nil
        view.removeFromSuperview()
        if index < marks.count { marks.remove(at:index) }
        makeFirstResponder(canvas)
        canvas?.flash("글상자를 지웠습니다")
        canvas?.needsDisplay=true
    }
    func openEditor(_ index: Int) {
        guard index < marks.count, marks[index].kind == .text, let canvas=canvas else { return }
        closeEditor(keep:true)
        editing=index
        let box=inkBox
        let sx=box.width/max(shown.size.width,1)
        let mark=marks[index]
        let size=textSize(mark,scale:sx)
        let origin=NSPoint(x:box.minX+mark.from.x*sx,
                           y:box.minY+mark.from.y*(box.height/max(shown.size.height,1)))
        textTop=NSPoint(x:origin.x,y:origin.y+size.height)
        let view=InkText(frame:NSRect(origin:origin,size:NSSize(width:max(size.width,40),height:size.height)))
        view.pin=self
        view.isRichText=true; view.isFieldEditor=false
        view.usesFontPanel=false; view.isAutomaticQuoteSubstitutionEnabled=false
        view.drawsBackground=false; view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer?.lineFragmentPadding=0
        view.textContainer?.widthTracksTextView=false
        view.textContainer?.containerSize=NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude)
        view.isHorizontallyResizable=true; view.isVerticallyResizable=true
        view.font=NSFont.boldSystemFont(ofSize:max(6,mark.size*sx))
        view.textColor=mark.color
        view.insertionPointColor=mark.color
        view.textStorage?.setAttributedString(PinWindow.attributed(mark,scale:sx))
        if mark.text.isEmpty { view.string="" }
        // 이어서 칠 글자도 지금 색을 따르게 한다.
        view.typingAttributes=[.font:view.font ?? NSFont.boldSystemFont(ofSize:14),.foregroundColor:mark.color]
        canvas.addSubview(view)
        editor=view
        makeKeyAndOrderFront(nil)
        makeFirstResponder(view)
        view.setSelectedRange(NSRange(location:mark.text.count,length:0))
        editorGrew()
        canvas.needsDisplay=true
    }
    // 글상자가 들고 있는 글자색을 표시로 옮긴다. 색을 바꾼 블록이 그대로 그림에 남는다.
    func harvestTints() {
        guard let view=editor, let index=editing, index < marks.count,
              let store=view.textStorage else { return }
        var picked:[NSColor]=[]
        picked.reserveCapacity(store.length)
        for i in 0..<store.length {
            let colour=store.attribute(.foregroundColor,at:i,effectiveRange:nil) as? NSColor
            picked.append(colour ?? marks[index].color)
        }
        marks[index].tints=picked
    }
    // 줄이 늘면 아래로 자란다. 왼쪽 위 자리는 그대로 둔다.
    func editorGrew() {
        guard let view=editor, let index=editing, index < marks.count else { return }
        marks[index].text=view.string
        harvestTints()
        let box=inkBox
        let sx=box.width/max(shown.size.width,1), sy=box.height/max(shown.size.height,1)
        var probe=marks[index]; probe.text=view.string
        let size=textSize(probe,scale:sx)
        let frame=NSRect(x:textTop.x,y:textTop.y-size.height,width:max(size.width+8,40),height:size.height)
        if view.frame != frame { view.frame=frame }
        marks[index].from=NSPoint(x:(frame.minX-box.minX)/max(sx,0.0001),y:(frame.minY-box.minY)/max(sy,0.0001))
        canvas?.needsDisplay=true
    }
    // 글상자에서 고른 부분이 있으면 그 부분만, 없으면 글 전체의 색을 바꾼다.
    func paintSelection(_ colour: NSColor) {
        guard let view=editor, let index=editing, index < marks.count else { return }
        let whole=NSRange(location:0,length:(view.string as NSString).length)
        let picked=view.selectedRange()
        let target = picked.length>0 ? picked : whole
        view.textStorage?.addAttribute(.foregroundColor,value:colour,range:target)
        var typing=view.typingAttributes; typing[.foregroundColor]=colour; view.typingAttributes=typing
        if target == whole { marks[index].color=colour }
        harvestTints()
        canvas?.needsDisplay=true
    }
    // 색 고르개. 모달이 아니라 옆에 뜨는 창이라 앱이 멈추지 않는다.
    @objc func paletteChanged(_ sender: NSColorPanel) {
        Ink.custom=sender.color
        inkIndex=Ink.customIndex
        paintSelection(sender.color)
        canvas?.needsDisplay=true
    }
    func openPalette() {
        let panel=NSColorPanel.shared
        panel.setTarget(self)
        panel.setAction(#selector(paletteChanged(_:)))
        panel.color=Ink.custom
        panel.isContinuous=true
        panel.level=Pin.snipLevel
        NSApp.activate(ignoringOtherApps:true)
        panel.makeKeyAndOrderFront(nil)
        canvas?.flash("색을 고르면 바로 칠합니다 · 고른 부분이 있으면 그 부분만")
    }
    func setTextSize(_ index: Int, to wanted: CGFloat) {
        guard index < marks.count else { return }
        marks[index].size=max(8,min(200,wanted))
        if editing == index, let view=editor {
            let sx=inkBox.width/max(shown.size.width,1)
            view.font=NSFont.boldSystemFont(ofSize:max(6,marks[index].size*sx))
            editorGrew()
        }
        canvas?.needsDisplay=true
    }
    func moveText(_ index: Int, to place: NSPoint) {
        guard index < marks.count else { return }
        marks[index].from=place
        if editing == index {
            let box=inkBox
            let sx=box.width/max(shown.size.width,1), sy=box.height/max(shown.size.height,1)
            var probe=marks[index]; probe.text=editor?.string ?? probe.text
            let size=textSize(probe,scale:sx)
            textTop=NSPoint(x:box.minX+place.x*sx,y:box.minY+place.y*sy+size.height)
            editorGrew()
        }
        canvas?.needsDisplay=true
    }
    @discardableResult func closeEditor(keep: Bool) -> Bool {
        guard let view=editor, let index=editing else { return false }
        harvestTints()
        let body=view.string
        editor=nil; editing=nil
        view.removeFromSuperview()
        if index < marks.count {
            if keep && !body.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty { marks[index].text=body }
            else { marks.remove(at:index) }
        }
        makeFirstResponder(canvas)
        canvas?.needsDisplay=true
        return true
    }
    func inkBegin(at point: NSPoint) {
        let here=toImage(point)
        let (thick,size)=Ink.hefts[min(heftIndex,Ink.hefts.count-1)]
        var mark=Mark(kind:tool,color:Ink.inks[min(inkIndex,Ink.inks.count-1)],width:thick,size:size)
        mark.from=here; mark.to=here
        if tool == .pen { mark.points=[here] }
        if tool == .text {
            mark.text=""
            marks.append(mark)
            openEditor(marks.count-1)
            canvas?.flash("Return 줄바꿈 · Esc 마침 · 글을 끌면 옮기고 모서리를 끌면 크기")
            return
        }
        live=mark
        canvas?.needsDisplay=true
    }
    func inkMove(to point: NSPoint) {
        guard var mark=live else { return }
        let here=toImage(point)
        if mark.kind == .pen { mark.points.append(here) } else { mark.to=here }
        live=mark
        canvas?.needsDisplay=true
    }
    func inkFinish() {
        guard var mark=live else { return }
        live=nil
        if mark.kind == .mosaic { mark.tile=mosaicTile(mark.box) }
        let enough = mark.kind == .pen ? mark.points.count>1 : (mark.box.width>3 || mark.box.height>3)
        if enough { marks.append(mark) }
        canvas?.needsDisplay=true
    }
}

final class MenuAction: NSObject {
    let run: ()->Void
    init(_ run: @escaping ()->Void) { self.run=run }
    @objc func fire(_ sender: Any?) { run() }
}
final class SnipView: NSView {
    var shot: NSImage?
    var origin: NSPoint?
    var current: NSPoint?
    var done: ((NSRect)->Void)?
    var cancelled: (()->Void)?
    override var isOpaque: Bool { true }
    override var acceptsFirstResponder: Bool { true }
    var selection: NSRect {
        guard let a=origin,let b=current else { return .zero }
        return NSRect(x:min(a.x,b.x),y:min(a.y,b.y),width:abs(a.x-b.x),height:abs(a.y-b.y))
    }
    override func resetCursorRects() { addCursorRect(bounds,cursor:.crosshair) }
    override func draw(_ dirtyRect: NSRect) {
        shot?.draw(in:bounds,from:.zero,operation:.copy,fraction:1)
        let box=selection
        NSColor.black.withAlphaComponent(0.45).setFill()
        if box.width<1||box.height<1 { bounds.fill(using:.sourceOver) }
        else {
            let outside=NSBezierPath(rect:bounds); outside.append(NSBezierPath(rect:box)); outside.windingRule = .evenOdd
            outside.fill(); outside.windingRule = .nonZero
            NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1).setStroke()
            let edge=NSBezierPath(rect:box); edge.lineWidth=2; edge.stroke()
            let label=" \(Int(box.width)) × \(Int(box.height)) "
            let high=box.maxY+8>bounds.maxY-24 ? box.minY-22 : box.maxY+6
            label.draw(at:NSPoint(x:box.minX,y:high),withAttributes:[.font:NSFont.boldSystemFont(ofSize:13),
                .foregroundColor:NSColor.black,.backgroundColor:NSColor(calibratedRed:0.87,green:0.95,blue:0.61,alpha:1)])
        }
        let guide=" 끌어서 화면 조각을 고르세요 · 고르면 바로 핀으로 붙습니다 · Esc 또는 오른쪽 클릭 취소 "
        guide.draw(at:NSPoint(x:40,y:bounds.maxY-56),withAttributes:[.font:NSFont.boldSystemFont(ofSize:15),
            .foregroundColor:NSColor.white,.backgroundColor:NSColor.black.withAlphaComponent(0.78)])
    }
    override func mouseDown(with event: NSEvent) { origin=convert(event.locationInWindow,from:nil); current=origin; needsDisplay=true }
    override func mouseDragged(with event: NSEvent) { current=convert(event.locationInWindow,from:nil); needsDisplay=true }
    override func mouseUp(with event: NSEvent) {
        let box=selection
        if box.width>=6 && box.height>=6 { done?(box) } else { cancelled?() }
    }
    override func rightMouseDown(with event: NSEvent) { cancelled?() }
    override func keyDown(with event: NSEvent) { if event.keyCode==53 { cancelled?() } else { super.keyDown(with:event) } }
}
final class SnipOverlay: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}

// MARK: Chrome native messaging host
// Chrome launches this same binary with the caller origin as an argument. In that mode there is no
// menu bar app: the process watches the clipboard for as long as the extension keeps the port open.
// 캡처와 핀은 바탕화면을 어지르지 않도록 바탕화면 아래 ‘캡처이미지’ 폴더에 모은다.
// 폴더는 처음 저장할 때 만든다. 만들지 못하면 예전처럼 바탕화면에 남긴다.
enum Shots {
    static let name = "캡처이미지"
    static var desktop: URL? { FileManager.default.urls(for: .desktopDirectory, in: .userDomainMask).first }
    static var folder: URL? {
        guard let base = desktop else { return nil }
        let target = base.appendingPathComponent(name)
        var isDirectory: ObjCBool = false
        if FileManager.default.fileExists(atPath:target.path,isDirectory:&isDirectory) {
            return isDirectory.boolValue ? target : base
        }
        do { try FileManager.default.createDirectory(at:target,withIntermediateDirectories:true) }
        catch { return base }
        return target
    }
}

enum NativeHost {
    // 직접 올린(개발자 모드) 판과 크롬 웹 스토어 판은 확장 ID 가 다르다. 둘 다 받아들인다.
    static let extensionIDs = ["ehgodopakibamgeopmelemjmjdjhbdgm","cgefngalkalghipmhijniclmlpimpmhf"]
    static let prefix = "다있쌤-캡처-"
    static let oldPrefix = "보완관-캡처-"        // 이름을 바꾸기 전 파일
    static let out = FileHandle.standardOutput
    static let writeLock = NSLock()
    static var collecting = false
    static var lastChange = 0
    static var lastText = ""
    static var seen = Set<String>()
    static var watchFrom = Date()
    static var toldAboutFolder = false

    // 감시는 바탕화면을 본다. macOS 의 스크린샷이 거기에 떨어지기 때문이다.
    // 우리가 저장하는 캡처는 바탕화면 아래 ‘캡처이미지’ 폴더로 들어간다.
    static var desktop: URL? { Shots.desktop }
    static var shots: URL? { Shots.folder }

    static func send(_ object: [String:Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject:object) else { return }
        var length = UInt32(data.count).littleEndian
        writeLock.lock()
        out.write(Data(bytes:&length,count:4))
        out.write(data)
        writeLock.unlock()
    }
    static func thumbnail(_ image: NSImage) -> String? {
        let size = image.size
        guard size.width > 0, size.height > 0 else { return nil }
        let factor = min(1, 240/max(size.width,size.height))
        let width = Int(max(1,size.width*factor)), height = Int(max(1,size.height*factor))
        guard let rep = NSBitmapImageRep(bitmapDataPlanes:nil,pixelsWide:width,pixelsHigh:height,bitsPerSample:8,samplesPerPixel:4,hasAlpha:true,isPlanar:false,colorSpaceName:.deviceRGB,bytesPerRow:0,bitsPerPixel:0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep:rep)
        image.draw(in:NSRect(x:0,y:0,width:CGFloat(width),height:CGFloat(height)))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using:.png,properties:[:])?.base64EncodedString()
    }
    static func pngData(_ board: NSPasteboard) -> (Data, NSImage)? {
        guard let image = NSImage(pasteboard:board) else { return nil }
        if let raw = board.data(forType:.png) { return (raw,image) }
        guard let tiff = image.tiffRepresentation, let rep = NSBitmapImageRep(data:tiff),
              let png = rep.representation(using:.png,properties:[:]) else { return nil }
        return (png,image)
    }
    static func saveImage(_ board: NSPasteboard) {
        guard let folder = shots, let (data,image) = pngData(board) else { return }
        let stamp = DateFormatter()
        stamp.dateFormat = "yyyyMMdd-HHmmss"
        var name = prefix + stamp.string(from:Date()) + ".png"
        var target = folder.appendingPathComponent(name)
        var counter = 1
        while FileManager.default.fileExists(atPath:target.path) {
            counter += 1
            name = prefix + stamp.string(from:Date()) + "-\(counter).png"
            target = folder.appendingPathComponent(name)
        }
        do { try data.write(to:target) } catch {
            send(["kind":"error","message":"바탕화면의 ‘캡처이미지’ 폴더에 저장하지 못했습니다."]); return
        }
        send(["kind":"image","file":target.path,"name":name,
              "width":Int(image.size.width),"height":Int(image.size.height),
              "thumb":thumbnail(image) ?? ""])
    }
    static func isShot(_ name: String) -> Bool {
        if name.hasPrefix(prefix) || name.hasPrefix(oldPrefix) { return false }
        guard name.lowercased().hasSuffix(".png") else { return false }
        let lower = name.lowercased()
        return name.hasPrefix("스크린샷") || lower.hasPrefix("screenshot") || lower.hasPrefix("screen shot")
    }
    static func pollDesktop() {
        guard collecting, let folder = desktop else { return }
        guard let names = try? FileManager.default.contentsOfDirectory(atPath:folder.path) else {
            if !toldAboutFolder {
                toldAboutFolder = true
                send(["kind":"error","message":"바탕화면 폴더를 읽지 못했습니다. 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더에서 바탕화면 접근을 허용해 주세요."])
            }
            return
        }
        for name in names where isShot(name) {
            let path = folder.appendingPathComponent(name).path
            guard !seen.contains(path) else { continue }
            seen.insert(path)
            guard let marks = try? FileManager.default.attributesOfItem(atPath:path),
                  let born = marks[.creationDate] as? Date, born >= watchFrom else { continue }
            guard let image = NSImage(contentsOfFile:path) else { continue }
            send(["kind":"image","file":path,"name":name,
                  "width":Int(image.size.width),"height":Int(image.size.height),
                  "thumb":thumbnail(image) ?? ""])
        }
    }
    static func poll() {
        let board = NSPasteboard.general
        guard board.changeCount != lastChange else { return }
        lastChange = board.changeCount
        guard collecting else { return }
        if board.data(forType:.png) != nil || board.data(forType:.tiff) != nil { saveImage(board); return }
        if let text = board.string(forType:.string), !text.isEmpty, text != lastText {
            lastText = text
            send(["kind":"text","text":String(text.prefix(2000))])
        }
    }
    // Only our own captures may be read back, so a stray request cannot open other files.
    // 예전 메모는 바탕화면 경로를 들고 있으므로 두 폴더를 모두 허용한다.
    static func allowed(_ path: String) -> Bool {
        let homes = [desktop?.standardizedFileURL.path, shots?.standardizedFileURL.path].compactMap{$0}
        guard !homes.isEmpty else { return false }
        let full = URL(fileURLWithPath:path).standardizedFileURL
        return homes.contains(full.deletingLastPathComponent().path)
            && full.pathExtension.lowercased() == "png" && FileManager.default.fileExists(atPath:full.path)
    }
    // 확장의 캡처 도구가 만든 그림을 바탕화면 ‘캡처이미지’ 폴더에 저장하고 클립보드에 올린다.
    // 확장은 바탕화면에 쓸 수 없고(내려받기 폴더뿐), 서비스 워커는 클립보드를 만질 수 없다.
    // 이름은 ‘다있쌤-스크린샷-’ 으로 한다. ‘다있쌤-캡처-’ 는 메모 자동 가져오기가 읽는 이름이다.
    static func shot(_ message: [String:Any]) {
        guard let encoded = message["image"] as? String, let data = Data(base64Encoded:encoded),
              let image = NSImage(data:data), image.size.width > 0 else {
            send(["kind":"shot","ok":false,"message":"그림을 읽지 못했습니다."]); return
        }
        var saved = ""
        if message["save"] as? Bool ?? true {
            let jpg = (message["ext"] as? String) == "jpg"
            let stamp = DateFormatter()
            stamp.locale = Locale(identifier:"en_US_POSIX"); stamp.dateFormat = "yyyy-MM-dd HH.mm.ss"
            let base = "다있쌤-스크린샷-"+stamp.string(from:Date())
            guard let folder = Shots.folder else {
                send(["kind":"shot","ok":false,"message":"바탕화면 폴더를 찾지 못했습니다."]); return
            }
            // 같은 초에 두 장을 찍어도 덮어쓰지 않는다.
            var target = folder.appendingPathComponent(base+(jpg ? ".jpg" : ".png"))
            var count = 2
            while FileManager.default.fileExists(atPath:target.path) {
                target = folder.appendingPathComponent(base+" (\(count))"+(jpg ? ".jpg" : ".png")); count += 1
            }
            do { try data.write(to:target); saved = target.path }
            catch {
                send(["kind":"shot","ok":false,"message":"‘캡처이미지’ 폴더에 저장하지 못했습니다. 시스템 설정 → 개인정보 보호 및 보안 → 파일 및 폴더에서 바탕화면 접근을 허용해 주세요."]); return
            }
        }
        var copied = false
        if message["copy"] as? Bool ?? true {
            let board = NSPasteboard.general
            board.clearContents()
            copied = board.writeObjects([image])
            lastChange = board.changeCount
        }
        send(["kind":"shot","ok":true,"path":saved,"copied":copied])
    }
    // 그림 속 글자를 읽는다. 기기 안의 Vision 으로만 읽고 어디에도 보내지 않는다.
    static func ocr(_ message: [String:Any]) {
        guard let encoded = message["image"] as? String, let data = Data(base64Encoded:encoded),
              let source = CGImageSourceCreateWithData(data as CFData,nil),
              let picture = CGImageSourceCreateImageAtIndex(source,0,nil) else {
            send(["kind":"ocr","ok":false,"message":"그림을 읽지 못했습니다."]); return
        }
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        request.recognitionLanguages = ["ko-KR","en-US"]
        do { try VNImageRequestHandler(cgImage:picture,options:[:]).perform([request]) }
        catch { send(["kind":"ocr","ok":false,"message":"글자를 읽지 못했습니다."]); return }
        // 위에서 아래로, 같은 줄이면 왼쪽부터. Vision 의 좌표는 아래가 0 이다.
        let found = (request.results ?? []).sorted {
            abs($0.boundingBox.midY-$1.boundingBox.midY) > 0.01 ? $0.boundingBox.midY > $1.boundingBox.midY
                                                                 : $0.boundingBox.minX < $1.boundingBox.minX
        }
        let lines = found.compactMap { $0.topCandidates(1).first?.string }
        send(["kind":"ocr","ok":true,"text":lines.joined(separator:"\n")])
    }
    // 녹화 표시기 명령을 앱으로 넘긴다. 답은 포트로 오가므로 짧게만 알린다.
    static func recorderOut(_ message: [String:Any]) {
        var payload:[String:String]=[:]
        for (key,value) in message where key != "type" { payload[key]=String(describing:value) }
        DistributedNotificationCenter.default().postNotificationName(
            Notification.Name("app.browsersheriff.presenter.recorder"),object:nil,
            userInfo:payload,deliverImmediately:true)
        send(["kind":"recorder","ok":true])
    }
    // 표시기의 단추를 누르면 앱이 알려 준다. 그것을 확장으로 올린다(오래 열어 둔 포트로).
    static var watchingRecorder = false
    static func watchRecorder() {
        guard !watchingRecorder else { send(["kind":"recorder","watching":true]); return }
        watchingRecorder = true
        DistributedNotificationCenter.default().addObserver(
            forName:Notification.Name("app.browsersheriff.recorder.button"),object:nil,queue:.main) { note in
            let which=(note.userInfo?["button"] as? String) ?? ""
            if !which.isEmpty { send(["kind":"recorder","button":which]) }
        }
        send(["kind":"recorder","watching":true])
    }
    // 시스템 설정의 ‘화면 및 시스템 오디오 녹음’ 을 연다. Chrome 에 권한을 주려면 여기서 켠다.
    static func openScreenSettings() {
        if let url=URL(string:"x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture") {
            NSWorkspace.shared.open(url)
        }
        send(["kind":"screen-settings","ok":true])
    }
    static func copyFile(_ path: String) {
        guard allowed(path), let image = NSImage(contentsOfFile:path) else {
            send(["kind":"error","message":"바탕화면과 ‘캡처이미지’ 폴더의 캡처 파일만 클립보드에 올릴 수 있습니다."]); return
        }
        let board = NSPasteboard.general
        board.clearContents()
        board.writeObjects([image])
        lastChange = board.changeCount
        send(["kind":"copied","file":path])
    }
    static func handle(_ message: [String:Any]) {
        switch message["type"] as? String {
        case "start":
            // ready 는 여기서만 보낸다. 띄우자마자 보내면 sendNativeMessage 가 "첫 번째" 답만
            // 받고 포트를 닫는 탓에, 발표 상태 대신 ready 가 확장에 전달되어 사이드바가 늘
            // 빈손이었다. 오래 열어 두는 포트(클립보드 도우미)만 start 를 보낸다.
            send(["kind":"ready","platform":"mac","desktop":shots?.path ?? desktop?.path ?? ""])
            collecting = true
            lastChange = NSPasteboard.general.changeCount
            watchFrom = Date()
            toldAboutFolder = false
            seen = []
            if let folder = desktop, let names = try? FileManager.default.contentsOfDirectory(atPath:folder.path) {
                for name in names { seen.insert(folder.appendingPathComponent(name).path) }
            }
            send(["kind":"state","collecting":true])
        case "stop": collecting = false; send(["kind":"state","collecting":false])
        case "copy-file": copyFile(message["file"] as? String ?? "")
        case "shot": shot(message)
        case "ocr": ocr(message)
        case "recorder": recorderOut(message)
        case "recorder-watch": watchRecorder()
        case "screen-settings": openScreenSettings()
        case "presenter": forward(message)
        case "guest": launchGuest()
        // 모르는 명령에도 반드시 답한다. 답하지 않으면 확장이 끝없이 기다린다.
        default: send(["kind":"unknown","ok":false,"message":"이 도우미가 모르는 명령입니다. 새 버전을 설치해 주세요."])
        }
    }
    // 사이드바의 명령을 메뉴 막대 앱으로 넘긴다. Chrome 이 띄운 이 프로세스와 앱은 별개다.
    static func presenterState() -> [String:Any] {
        let mine = ProcessInfo.processInfo.processIdentifier
        let alive = NSRunningApplication.runningApplications(withBundleIdentifier:"app.browsersheriff.presenter")
            .contains { $0.processIdentifier != mine }
        // running: 앱이 떠 있는지. 꺼져 있으면 단축키도 듣지 않으므로 사이드바가 그렇게 알린다.
        guard alive, let file = Presenter.stateFile, let data = try? Data(contentsOf:file),
              let object = try? JSONSerialization.jsonObject(with:data) as? [String:Any] else {
            return ["presenting":false,"focus":false,"pins":0,"through":0,"camera":false,"running":alive]
        }
        var answer:[String:Any]=["presenting":object["presenting"] as? Bool ?? false,"focus":object["focus"] as? Bool ?? false,
                "pins":object["pins"] as? Int ?? 0,"through":object["through"] as? Int ?? 0,
                "camera":object["camera"] as? Bool ?? false,"running":true]
        if let keys=object["keys"] as? String { answer["keys"]=keys }
        return answer
    }
    static func forward(_ message: [String:Any]) {
        var payload:[String:String] = [:]
        for (key,value) in message where key != "type" { payload[key] = String(describing: value) }
        let mine = ProcessInfo.processInfo.processIdentifier
        let alive = NSRunningApplication.runningApplications(withBundleIdentifier:"app.browsersheriff.presenter")
            .contains { $0.processIdentifier != mine }
        func reply(_ launched: Bool) {
            var answer:[String:Any]=["kind":"presenter","ok":true,"launched":launched]
            for (key,value) in presenterState() { answer[key]=value }
            send(answer)
        }
        // 상태만 묻는 호출은 아무 것도 바꾸지 않는다.
        if message["action"] as? String == "state" { reply(false); return }
        // 앱이 상태 파일을 다시 썼는지 보는 표. 윈도우 세션이 같은 방식으로 고친 것을 맥에도 맞춘다.
        func stamp() -> Date {
            (try? FileManager.default.attributesOfItem(atPath:Presenter.stateFile?.path ?? "")[.modificationDate] as? Date) ?? Date.distantPast
        }
        func deliver(_ launched: Bool) {
            let before=stamp()
            DistributedNotificationCenter.default().postNotificationName(
                Notification.Name("app.browsersheriff.presenter.command"),
                object:nil,userInfo:payload,deliverImmediately:true)
            // 조절값만 온 것(action 이 없다)은 앱 상태를 바꾸지 않는다 — 기다릴 이유가 없다.
            // 슬라이더를 끄는 동안 이 0.4초가 그대로 손에 느껴지는 지연이었다.
            if message["action"] == nil { reply(launched); return }
            // 명령은 앱이 상태 파일을 고쳐 쓰는 즉시 답한다. 못 쓰면 예전처럼 0.4초까지 기다린다.
            func look(_ left: Int) {
                if left <= 0 || stamp() != before { reply(launched); return }
                DispatchQueue.main.asyncAfter(deadline:.now()+0.02) { look(left-1) }
            }
            look(20)
        }
        // 앱이 이미 떠 있으면 바로 보낸다. 미루면 한 번짜리 호출에서 프로세스가 먼저 끝나 버린다.
        if alive { deliver(false); return }
        let configuration = NSWorkspace.OpenConfiguration()
        configuration.activates = false
        NSWorkspace.shared.openApplication(at:Bundle.main.bundleURL,configuration:configuration,completionHandler:nil)
        DispatchQueue.main.asyncAfter(deadline:.now()+2.0) { deliver(true) }
    }
    // 확장은 게스트 프로필 창을 열 수 없다. Chrome 을 --guest 로 한 번 더 띄우면 이미 떠 있는
    // Chrome 이 게스트 창을 연다.
    static func launchGuest() {
        let candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                          NSHomeDirectory()+"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
        guard let binary = candidates.first(where:{FileManager.default.isExecutableFile(atPath:$0)}) else {
            send(["kind":"guest","ok":false,"message":"Google Chrome 을 찾지 못했습니다."]); return
        }
        let task = Process()
        task.executableURL = URL(fileURLWithPath:binary)
        task.arguments = ["--guest"]
        do { try task.run(); send(["kind":"guest","ok":true]) }
        catch { send(["kind":"guest","ok":false,"message":"게스트 창을 열지 못했습니다."]) }
    }
    static func run() -> Never {
        guard CommandLine.arguments.contains(where:{arg in extensionIDs.contains{arg.hasPrefix("chrome-extension://\($0)")}}) else { exit(1) }
        lastChange = NSPasteboard.general.changeCount
        let timer = Timer(timeInterval:0.5,repeats:true) { _ in poll(); pollDesktop() }
        RunLoop.main.add(timer,forMode:.common)
        let input = FileHandle.standardInput
        Thread.detachNewThread {
            while true {
                guard let header = try? input.read(upToCount:4), header.count == 4 else { break }
                let length = Int(header.withUnsafeBytes { $0.loadUnaligned(as:UInt32.self) }.littleEndian)
                // 캡처 그림(전체 페이지는 수십 MB)을 받으므로 넉넉히 둔다. Chrome 이 보내는 쪽 한도는 4GB.
                guard length > 0, length <= 96 * 1_048_576,
                      let body = try? input.read(upToCount:length), body.count == length,
                      let object = try? JSONSerialization.jsonObject(with:body) as? [String:Any] else { break }
                DispatchQueue.main.async { handle(object) }
            }
            // chrome.runtime.sendNativeMessage 는 보내자마자 stdin 을 닫는다. 바로 끝내면
            // 방금 큐에 넣은 처리와 앱 실행 대기가 날아간다.
            DispatchQueue.main.asyncAfter(deadline:.now()+4) { exit(0) }
        }
        RunLoop.main.run()
        exit(0)
    }
}
if CommandLine.arguments.contains(where:{$0.hasPrefix("chrome-extension://")}) { NativeHost.run() }

// Two copies of the bundle can sit on disk, and macOS records screen recording permission per copy.
// Letting both run leaves two menu bar icons, and the granted one is rarely the one being clicked.
let mine = ProcessInfo.processInfo.processIdentifier
let twins = NSRunningApplication.runningApplications(withBundleIdentifier:"app.browsersheriff.presenter")
    .filter { $0.processIdentifier != mine }
if !twins.isEmpty {
    let notice=NSAlert()
    notice.messageText="발표 도우미가 이미 실행 중입니다"
    notice.informativeText="메뉴 막대 오른쪽의 돋보기 아이콘을 사용하세요.\n\n같은 앱을 두 벌 실행하면 화면 기록 권한이 한쪽에만 붙어 권한 요청이 반복됩니다. 앱은 한 곳에만 두고 쓰세요."
    notice.addButton(withTitle:"확인")
    notice.runModal()
    exit(0)
}

let application=NSApplication.shared
let delegate=Presenter()
application.delegate=delegate
application.setActivationPolicy(.accessory)
application.run()
