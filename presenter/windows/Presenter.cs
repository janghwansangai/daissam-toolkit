using System;
using System.Drawing;
using System.Drawing.Drawing2D;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Threading;
using System.Windows.Forms;
using Microsoft.Win32;

namespace BrowserSheriff {
  static class Native {
    public delegate IntPtr Hook(int code,IntPtr message,IntPtr data);
    [StructLayout(LayoutKind.Sequential)] public struct Point {public int X,Y;}
    [StructLayout(LayoutKind.Sequential)] public struct Mouse {public Point pt;public uint mouseData,flags,time;public UIntPtr extra;}
    [DllImport("Magnification.dll")] public static extern bool MagInitialize();
    [DllImport("Magnification.dll")] public static extern bool MagUninitialize();
    [DllImport("Magnification.dll")] public static extern bool MagSetFullscreenTransform(float level,int x,int y);
    [DllImport("Magnification.dll")] public static extern bool MagGetFullscreenTransform(out float level,out int x,out int y);
    [DllImport("Magnification.dll")] public static extern bool MagShowSystemCursor(bool show);
    [DllImport("user32.dll")] public static extern IntPtr SetWindowsHookEx(int type,Hook callback,IntPtr module,uint thread);
    [DllImport("user32.dll")] public static extern bool UnhookWindowsHookEx(IntPtr hook);
    [DllImport("user32.dll")] public static extern IntPtr CallNextHookEx(IntPtr hook,int code,IntPtr message,IntPtr data);
    [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
    // 저수준 키 훅은 발표 중에만 걸려 있다. 발표를 '시작'하는 키는 그 전에 들려야 하므로
    // 창에 붙는 진짜 전역 단축키(RegisterHotKey)로 따로 등록한다.
    // 이 창을 화면 녹화·공유에서 빼 준다(Windows 10 2004+). 녹화 표시기에 쓴다.
    [DllImport("gdi32.dll")] public static extern IntPtr CreateRoundRectRgn(int left,int top,int right,int bottom,int wide,int tall);
    [DllImport("user32.dll")] public static extern bool SetWindowDisplayAffinity(IntPtr window,uint affinity);
    public const uint ExcludeFromCapture=0x00000011;   // WDA_EXCLUDEFROMCAPTURE
    [DllImport("user32.dll")] public static extern bool ReleaseCapture();
    [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr window,int message,int wParam,int lParam);
    [DllImport("user32.dll")] public static extern bool RegisterHotKey(IntPtr window,int id,uint mods,uint key);
    [DllImport("user32.dll")] public static extern bool UnregisterHotKey(IntPtr window,int id);
    [DllImport("user32.dll")] public static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] public static extern uint GetClipboardSequenceNumber();
    [DllImport("kernel32.dll",CharSet=CharSet.Auto)] public static extern IntPtr GetModuleHandle(string name);
    [DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr GetWindowLongPtr(IntPtr window,int index);
    [DllImport("user32.dll",SetLastError=true)] public static extern IntPtr SetWindowLongPtr(IntPtr window,int index,IntPtr value);
  }
  sealed class PointerWindow:Form {
    // MagSetFullscreenTransform magnifies the whole desktop, this window included. Drawing at 1/zoom
    // keeps the pointer the same size on screen no matter how far the content is zoomed in.
    // 예전에는 TransparencyKey 로 분홍색을 투명하게 만들었다. 그 방식은 화면 합성에 기대는데,
    // VMware 같은 가상 디스플레이 드라이버에서는 합성이 빠져 분홍색이 그대로 칠해진다. 그래서
    // 포인터 자리에 속이 꽉 찬 분홍 원이 생기고 아래가 안 보였다. 이제 창 모양(Region)을
    // 고리로 깎는다. 가운데는 창 자체가 없으므로 어느 드라이버에서도 그냥 아래가 보이고,
    // 클릭도 지나간다. 색 키에 기대지 않는다.
    public const int Diameter0=104;
    float shrink=1;
    int span=Diameter0;
    Color ink=Color.FromArgb(222,243,155);
    // WS_EX_LAYERED 를 단 창은 SetLayeredWindowAttributes 를 한 번은 불러 줘야 화면에 나온다.
    // 예전에는 TransparencyKey 가 그 일을 했다. 그것을 걷어냈으므로 Opacity 로 대신한다.
    // 겸사겸사 살짝 비쳐서 고리 아래 글자도 읽힌다.
    public PointerWindow(){FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;Size=new Size(Diameter0,Diameter0);DoubleBuffered=true;Opacity=.9;Carve();}
    public Color Ink {get{return ink;}set{if(ink==value)return;ink=value;Invalidate();}}
    public int Span {
      get{return span;}
      set{
        int wanted=Math.Max(16,Math.Min(280,value));
        if(span==wanted)return;
        span=wanted;Refit();
      }
    }
    public float Shrink {
      get{return shrink;}
      set{
        float wanted=Math.Max(.25f,Math.Min(1f,value));
        if(Math.Abs(shrink-wanted)<0.005f)return;
        shrink=wanted;Refit();
      }
    }
    void Refit(){
      int side=Math.Max(10,(int)Math.Ceiling(span*shrink));
      if(Width!=side)Size=new Size(side,side);
      Carve();Invalidate();
    }
    // 고리 두께는 지름의 1/14. 예전 1/7 이 너무 굵다는 의견이라 절반으로 줄였다.
    // 아주 작게 줄어들 때를 대비해 2px 아래로는 내려가지 않는다.
    float Band {get{return Math.Max(2f,Width/14f);}}
    void Carve(){
      float outer=Width/2f,inner=Math.Max(1f,outer-Band);
      using(GraphicsPath path=new GraphicsPath()){
        path.AddEllipse(0,0,Width,Height);
        path.AddEllipse(outer-inner,outer-inner,inner*2,inner*2);
        Region=new Region(path);
      }
    }
    public int Half {get{return Width/2;}}
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{CreateParams p=base.CreateParams;p.ExStyle|=0x00000020|0x00080000|0x08000000|0x80;return p;}}
    protected override void OnPaint(PaintEventArgs e){
      // 창 모양이 이미 고리다. 고리만 칠하고 가운데는 손대지 않는다.
      e.Graphics.SmoothingMode=SmoothingMode.AntiAlias;
      float band=Band,mid=band/2f;
      using(Pen ring=new Pen(ink,band))e.Graphics.DrawEllipse(ring,mid,mid,Width-band,Height-band);
      // 밝은 화면에서도 고리가 묻히지 않도록 안팎에 얇은 진한 선을 두른다.
      float hair=Math.Min(1.2f,band*0.3f);
      using(Pen edge=new Pen(Color.FromArgb(150,16,51,41),hair)){
        e.Graphics.DrawEllipse(edge,hair/2,hair/2,Width-hair,Height-hair);
        e.Graphics.DrawEllipse(edge,band-hair/2,band-hair/2,Width-band*2+hair,Height-band*2+hair);
      }
    }
    // Region 이 이미 고리 밖을 잘라내므로, 배경을 고리 색으로 칠하면 그게 곧 고리다.
    protected override void OnPaintBackground(PaintEventArgs e){using(SolidBrush fill=new SolidBrush(ink))e.Graphics.FillRectangle(fill,ClientRectangle);}
  }
  sealed class SpotlightWindow:Form {
    // MagSetFullscreenTransform exposes no pixels to blur, so focus mode dims the area outside the circle.
    Rectangle hole=Rectangle.Empty;
    public SpotlightWindow(Rectangle screen,double dim){
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
      Bounds=screen;BackColor=Color.FromArgb(8,22,18);Opacity=Math.Max(.05,Math.Min(.9,dim));DoubleBuffered=true;
    }
    protected override bool ShowWithoutActivation {get{return true;}}
    protected override CreateParams CreateParams {get{CreateParams p=base.CreateParams;p.ExStyle|=0x00000020|0x00080000|0x08000000|0x80;return p;}}
    // 커서가 다른 모니터로 가면 덮개도 그 모니터로 옮긴다.
    public void Cover(Rectangle screen){
      if(Bounds!=screen){Bounds=screen;hole=Rectangle.Empty;}
    }
    public void Focus(Point centre,int radius){
      Rectangle wanted=new Rectangle(centre.X-Left-radius,centre.Y-Top-radius,radius*2,radius*2);
      if(Math.Abs(wanted.X-hole.X)<2&&Math.Abs(wanted.Y-hole.Y)<2&&wanted.Width==hole.Width)return;
      hole=wanted;
      using(GraphicsPath path=new GraphicsPath()){
        path.AddRectangle(new Rectangle(0,0,Width,Height));
        path.AddEllipse(hole);
        Region=new Region(path);
      }
    }
  }
  // 화면 조각 핀 (Snipaste 의 붙이기). 잘라낸 그림을 늘 위에 뜨는 작은 창으로 띄운다.
  // Windows 의 확대는 MagSetFullscreenTransform 이 바탕화면 전체를 키우는 방식이라 핀도 같이
  // 커진다. PointerWindow 가 1/zoom 으로 그리는 것과 같은 이유로, 핀도 배율만큼 실제 크기를
  // 줄이고 자리를 옮겨 화면에 보이는 크기와 위치를 일정하게 유지한다.
  // 조각 위에 그리기. 표시는 그림 좌표로 담는다. 그래야 핀을 키우거나 줄여도 같은 자리에 남고,
  // 굽기(Flatten)할 때 그대로 그려 넣을 수 있다.
  sealed class Mark {
    public int Kind;                    // 0 펜, 1 원, 2 선, 3 모자이크, 4 글자
    public List<PointF> Points=new List<PointF>();
    public PointF From,To;
    public Color Ink=Color.Red;
    // 글자마다의 색. 비어 있으면 전부 Ink 를 쓴다. 블록을 골라 색을 바꾸면 여기에 담긴다.
    public List<Color> Tints=new List<Color>();
    public float Width=5,Size=24;
    public string Text="";
    public Bitmap Tile;
    public RectangleF Box {
      get {
        return RectangleF.FromLTRB(Math.Min(From.X,To.X),Math.Min(From.Y,To.Y),
                                   Math.Max(From.X,To.X),Math.Max(From.Y,To.Y));
      }
    }
  }
  static class InkKit {
    // 마지막 한 칸은 팔레트에서 직접 고른 색이다. 누르면 색 고르개가 열린다.
    public const int CustomIndex=6;
    public static Color Custom=Color.FromArgb(153,77,217);
    static readonly Color[] Fixed={
      Color.FromArgb(217,48,38),Color.FromArgb(250,194,41),Color.FromArgb(56,168,87),
      Color.FromArgb(38,115,219),Color.FromArgb(23,23,23),Color.White};
    public static Color[] Inks {
      get{
        Color[] all=new Color[Fixed.Length+1];
        Array.Copy(Fixed,all,Fixed.Length);
        all[Fixed.Length]=Custom;
        return all;
      }
    }
    // 굵기와 글자 크기를 한 손잡이로 함께 움직인다.
    public static readonly float[][] Hefts={new float[]{2,15},new float[]{5,24},new float[]{11,40}};
    public static readonly string[] Tools={"✎","○","▁","▦","T"};
  }
  sealed class PinForm:Form {
    Bitmap source;
    Bitmap shown;
    readonly Presenter host;
    public Rectangle Natural;            // 배율 1 기준으로 화면에 보이길 바라는 자리
    float zoom=1;int turns=0;bool flipped=false;bool through=false;bool folded=false;
    bool hovering=false,dragging=false;Point grab;
    bool cropping=false;Rectangle cropBox=Rectangle.Empty;int grabbed=-1;Point grabFrom;Rectangle grabBox;
    string note="";System.Windows.Forms.Timer noteTimer;
    const int Edge=3,ToolSide=26,ToolGap=2,Grip=15;
    static readonly string[] Tools={"✕","✎","⛶","⧉","⬇","↻"};
    static readonly string[] CropTools={"✓","✕"};
    static readonly Color Lime=Color.FromArgb(222,243,155);
    static readonly Color Deep=Color.FromArgb(16,51,41);
    public bool Through {get{return through;}}
    // 조각 위에 그리기 ------------------------------------------------------
    bool drawing=false;int tool=0,inkIndex=0,heftIndex=1,typing=-1;
    // 예전에는 OnKeyPress 의 KeyChar 를 이어 붙여 글자를 만들었다. 한글 IME 는 조합이 끝나기
    // 전까지 WM_CHAR 를 주지 않으므로 글자가 한 자도 들어가지 않았다. 이제 진짜 글상자를 얹는다.
    // 조합도 줄바꿈도 되돌리기도 운영체제가 해 준다.
    RichTextBox editor;int editing=-1;Point textTop;bool harvesting=false;
    // 다음에 칠 글자의 색. HarvestTints 가 Select 를 돌리면 서식 글상자의 '이어서 칠 색'이
    // 커서 자리의 색으로 되돌아간다. 그래서 색을 바꿔도 다음 글자가 옛 색으로 나왔다.
    Color pendingInk=Color.Empty;
    // 고르기. 이미 그린 것을 눌러 고르고, 끌어 옮기고, 모퉁이로 크기를 바꾸고, 지운다.
    bool picking=false;int chosen=-1;
    int shifting=-1;Point shiftGrab;
    int stretching=-1;int stretchCorner=-1;RectangleF stretchFrom;
    int movingText=-1;Point moveGrab;PointF moveFrom;bool movedText=false;
    int sizingText=-1;Point sizeGrab;float sizeStart;
    readonly List<Mark> marks=new List<Mark>();
    Mark live;
    PointF ToImage(Point point){
      Rectangle box=Box;
      if(box.Width<=0||box.Height<=0)return PointF.Empty;
      return new PointF((point.X-box.Left)*shown.Width/(float)box.Width,
                        (point.Y-box.Top)*shown.Height/(float)box.Height);
    }
    void BeginDraw(){
      if(through||folded||cropping)return;
      drawing=true;live=null;typing=-1;editing=-1;movingText=-1;sizingText=-1;
      picking=false;chosen=-1;shifting=-1;stretching=-1;
      // 도구 줄과 색 줄이 모두 들어가는 폭. 색 칸이 7개가 되어 250 으로는 ⌫ 가 잘린다.
      if(Box.Width<300)SetZoom(zoom*300f/Math.Max(1,Box.Width));
      Focus();Flash("↖ 고르기로 다시 옮기고 지웁니다 · Ctrl 끌기로 핀 이동 · Esc 나 Enter 로 마침");Invalidate();
    }
    void EndDraw(bool keep){
      // 나가기 전에 글상자의 글을 먼저 담는다. 이 줄이 없으면 마지막 글이 그림에 안 들어간다.
      CloseEditor(keep);
      typing=-1;live=null;movingText=-1;sizingText=-1;
      picking=false;chosen=-1;shifting=-1;stretching=-1;
      if(keep&&marks.Count>0){
        Bitmap flat=Flatten();
        if(flat!=null){
          // 그린 것까지 그림 자체에 굽는다. 이제 복사·저장·자르기 모두 그대로 따라온다.
          Bitmap old=source;source=flat;turns=0;flipped=false;
          foreach(Mark mark in marks)if(mark.Tile!=null)mark.Tile.Dispose();
          marks.Clear();drawing=false;
          Rebuild();
          if(old!=null)old.Dispose();
          host.PlacePins();
          Flash("그린 내용을 그림에 넣었습니다");
          return;
        }
      }
      foreach(Mark mark in marks)if(mark.Tile!=null)mark.Tile.Dispose();
      marks.Clear();drawing=false;Invalidate();
    }
    Bitmap Flatten(){
      try{
        Bitmap flat=new Bitmap(shown.Width,shown.Height);
        using(Graphics g=Graphics.FromImage(flat)){
          g.InterpolationMode=InterpolationMode.HighQualityBicubic;
          g.DrawImage(shown,new Rectangle(0,0,shown.Width,shown.Height));
          PaintMarks(g,new Rectangle(0,0,shown.Width,shown.Height));
        }
        return flat;
      }catch{return null;}
    }
    // 화면에도 굽기에도 같은 코드를 쓴다. box 가 그림 전체를 어디에 그리는지를 정한다.
    void PaintMarks(Graphics g,Rectangle box){
      if(shown.Width<=0||shown.Height<=0)return;
      float sx=box.Width/(float)shown.Width, sy=box.Height/(float)shown.Height;
      Func<PointF,PointF> P=p=>new PointF(box.Left+p.X*sx,box.Top+p.Y*sy);
      Func<RectangleF,RectangleF> R=r=>new RectangleF(box.Left+r.X*sx,box.Top+r.Y*sy,r.Width*sx,r.Height*sy);
      g.SmoothingMode=SmoothingMode.AntiAlias;
      List<Mark> all=new List<Mark>(marks);
      if(live!=null)all.Add(live);
      foreach(Mark mark in all){
        float thick=Math.Max(0.5f,mark.Width*sx);
        using(Pen pen=new Pen(mark.Ink,thick)){
          pen.StartCap=LineCap.Round;pen.EndCap=LineCap.Round;pen.LineJoin=LineJoin.Round;
          if(mark.Kind==0){
            if(mark.Points.Count<2)continue;
            PointF[] path=new PointF[mark.Points.Count];
            for(int i=0;i<path.Length;i++)path[i]=P(mark.Points[i]);
            g.DrawLines(pen,path);
          }
          else if(mark.Kind==1)g.DrawEllipse(pen,R(mark.Box));
          else if(mark.Kind==2)g.DrawLine(pen,P(mark.From),P(mark.To));
          else if(mark.Kind==3){
            RectangleF area=R(mark.Box);
            if(mark.Tile!=null){
              InterpolationMode keep=g.InterpolationMode;
              g.InterpolationMode=InterpolationMode.NearestNeighbor;
              g.PixelOffsetMode=PixelOffsetMode.Half;
              g.DrawImage(mark.Tile,area);
              g.InterpolationMode=keep;
            } else {
              using(SolidBrush wash=new SolidBrush(Color.FromArgb(140,128,128,128)))g.FillRectangle(wash,area);
              g.DrawRectangle(pen,area.X,area.Y,area.Width,area.Height);
            }
          }
          else if(mark.Kind==4){
            if(mark.Text.Length==0)continue;
            // 고쳐 쓰는 중인 글상자는 진짜 글상자가 대신 보여 준다. 두 겹으로 보이면 안 된다.
            if(editing>=0&&editing<marks.Count&&object.ReferenceEquals(mark,marks[editing]))continue;
            PaintText(g,mark,P(mark.From),sx);
          }
        }
      }
    }
    // 글자 i 의 색. Tints 가 비어 있으면 전체 색을 쓴다.
    static Color TintAt(Mark mark,int i){
      return (i>=0&&i<mark.Tints.Count)?mark.Tints[i]:mark.Ink;
    }
    // 색이 같은 글자끼리 묶어 한 토막씩 그린다. 줄바꿈은 줄 높이만큼 내려서 잇는다.
    // GDI+ 는 한 번에 여러 색을 못 쓰므로 토막마다 경로를 만들어 테두리와 속을 칠한다.
    static void PaintText(Graphics g,Mark mark,PointF at,float scale){
      using(Font face=TextFace(mark.Size,scale))
      using(Pen edge=new Pen(Color.FromArgb(150,0,0,0),2f)){
        float lineHeight=face.GetHeight(g);
        string[] lines=mark.Text.Replace("\r\n","\n").Split('\n');
        int seen=0;
        for(int row=0;row<lines.Length;row++){
          string line=lines[row];
          float x=at.X, y=at.Y+row*lineHeight;
          int i=0;
          while(i<line.Length){
            Color tint=TintAt(mark,seen+i);
            int run=i;
            while(run<line.Length&&TintAt(mark,seen+run)==tint)run++;
            string piece=line.Substring(i,run-i);
            using(GraphicsPath path=new GraphicsPath()){
              path.AddString(piece,face.FontFamily,(int)FontStyle.Bold,face.Size,new PointF(x,y),StringFormat.GenericTypographic);
              g.DrawPath(edge,path);
              using(SolidBrush ink=new SolidBrush(tint))g.FillPath(ink,path);
            }
            x+=g.MeasureString(piece,face,int.MaxValue,StringFormat.GenericTypographic).Width;
            i=run;
          }
          seen+=line.Length+1;        // 줄바꿈 한 글자를 센다
        }
      }
    }
    // 글꼴은 그리기·자리 재기·글상자 셋이 같아야 한다. 어긋나면 글상자가 글 위에서 밀린다.
    public static Font TextFace(float size,float scale){
      return new Font("Malgun Gothic",Math.Max(5f,size*scale*0.75f)*1.35f,FontStyle.Bold,GraphicsUnit.Pixel);
    }
    SizeF TextSize(Mark mark,float scale){
      string body=mark.Text.Length==0?" ":mark.Text;
      using(Font face=TextFace(mark.Size,scale))using(Bitmap probe=new Bitmap(1,1))using(Graphics g=Graphics.FromImage(probe)){
        string[] lines=body.Replace("\r\n","\n").Split('\n');
        float wide=0,tall=face.GetHeight(g)*lines.Length;
        foreach(string line in lines){
          float w=g.MeasureString(line.Length==0?" ":line,face,int.MaxValue,StringFormat.GenericTypographic).Width;
          if(w>wide)wide=w;
        }
        return new SizeF(Math.Max(wide,12),Math.Max(tall,12));
      }
    }
    // 그림 좌표에서 글이 차지하는 네모. 눌러서 고르는 데 쓴다.
    RectangleF TextBoxOf(Mark mark){
      Rectangle box=Box;
      if(box.Width<=0||shown.Width<=0)return RectangleF.Empty;
      float sx=box.Width/(float)shown.Width, sy=box.Height/(float)shown.Height;
      SizeF size=TextSize(mark,sx);
      return new RectangleF(mark.From.X,mark.From.Y,size.Width/Math.Max(sx,0.0001f),size.Height/Math.Max(sy,0.0001f));
    }
    // 표시 하나가 그림 안에서 차지하는 네모. 고르고 옮기고 크기를 바꾸는 바탕이다.
    RectangleF MarkBox(Mark mark){
      if(mark.Kind==4)return TextBoxOf(mark);
      if(mark.Kind==0){
        if(mark.Points.Count==0)return RectangleF.Empty;
        float lx=mark.Points[0].X,rx=lx,ty=mark.Points[0].Y,by=ty;
        foreach(PointF q in mark.Points){
          if(q.X<lx)lx=q.X; if(q.X>rx)rx=q.X;
          if(q.Y<ty)ty=q.Y; if(q.Y>by)by=q.Y;
        }
        RectangleF r=new RectangleF(lx,ty,rx-lx,by-ty);r.Inflate(mark.Width,mark.Width);return r;
      }
      RectangleF box=mark.Box;box.Inflate(Math.Max(2f,mark.Width/2f),Math.Max(2f,mark.Width/2f));return box;
    }
    int MarkHit(Point point){
      PointF here=ToImage(point);
      for(int i=marks.Count-1;i>=0;i--){
        RectangleF r=MarkBox(marks[i]);r.Inflate(6,6);
        if(r.Contains(here))return i;
      }
      return -1;
    }
    Rectangle ChosenFrame(){
      if(chosen<0||chosen>=marks.Count)return Rectangle.Empty;
      Rectangle box=Box;
      if(box.Width<=0||shown.Width<=0)return Rectangle.Empty;
      float sx=box.Width/(float)shown.Width, sy=box.Height/(float)shown.Height;
      RectangleF r=MarkBox(marks[chosen]);
      return Rectangle.Round(new RectangleF(box.Left+r.X*sx,box.Top+r.Y*sy,r.Width*sx,r.Height*sy));
    }
    // 네 모퉁이 손잡이. 0 왼위 1 오른위 2 왼아래 3 오른아래
    Rectangle[] MarkGrips(){
      Rectangle f=ChosenFrame();
      if(f.Width<=0&&f.Height<=0)return new Rectangle[0];
      int g=11;
      return new Rectangle[]{
        new Rectangle(f.Left-g/2,f.Top-g/2,g,g), new Rectangle(f.Right-g/2,f.Top-g/2,g,g),
        new Rectangle(f.Left-g/2,f.Bottom-g/2,g,g), new Rectangle(f.Right-g/2,f.Bottom-g/2,g,g)};
    }
    Rectangle ChosenDropGrip(){
      Rectangle f=ChosenFrame();
      if(f.Width<=0&&f.Height<=0)return Rectangle.Empty;
      return new Rectangle(f.Right-2,f.Top-14,14,14);
    }
    void DropChosen(){
      if(chosen<0||chosen>=marks.Count)return;
      Mark gone=marks[chosen];if(gone.Tile!=null)gone.Tile.Dispose();
      marks.RemoveAt(chosen);chosen=-1;
      Flash("고른 것을 지웠습니다");Invalidate();
    }
    void ShiftMark(int index,float dx,float dy){
      if(index<0||index>=marks.Count)return;
      Mark m=marks[index];
      m.From=new PointF(m.From.X+dx,m.From.Y+dy);
      m.To=new PointF(m.To.X+dx,m.To.Y+dy);
      for(int i=0;i<m.Points.Count;i++)m.Points[i]=new PointF(m.Points[i].X+dx,m.Points[i].Y+dy);
    }
    // 네모를 새로 정해 그 안에 맞춰 늘린다.
    void StretchMark(int index,RectangleF old,RectangleF fresh){
      if(index<0||index>=marks.Count||old.Width<1||old.Height<1||fresh.Width<2||fresh.Height<2)return;
      float fx=fresh.Width/old.Width, fy=fresh.Height/old.Height;
      Mark m=marks[index];
      Func<PointF,PointF> map=q=>new PointF(fresh.X+(q.X-old.X)*fx,fresh.Y+(q.Y-old.Y)*fy);
      m.From=map(m.From);m.To=map(m.To);
      for(int i=0;i<m.Points.Count;i++)m.Points[i]=map(m.Points[i]);
      if(m.Kind==4)m.Size=Math.Max(8f,Math.Min(200f,m.Size*fy));
      else m.Width=Math.Max(1f,Math.Min(60f,m.Width*Math.Max(fx,fy)));
    }
    // 모자이크는 그 자리 픽셀로 미리 만들어 둔 조각이다. 옮기거나 늘렸으면 다시 만든다.
    void RemakeTile(int index){
      if(index<0||index>=marks.Count||marks[index].Kind!=3)return;
      if(marks[index].Tile!=null)marks[index].Tile.Dispose();
      marks[index].Tile=MosaicTile(marks[index].Box);
      Invalidate();
    }
    int TextHit(Point point){
      PointF here=ToImage(point);
      for(int i=marks.Count-1;i>=0;i--){
        if(marks[i].Kind!=4)continue;
        RectangleF r=TextBoxOf(marks[i]);r.Inflate(6,6);
        if(r.Contains(here))return i;
      }
      return -1;
    }
    // WinForms 글상자는 진짜 투명이 되지 않는다. 대신 그 자리 그림의 평균색을 배경으로 써서
    // 주변에 묻히게 한다. 검은 상자가 그림을 가려 어디에 쓰는지 안 보이던 것을 고친다.
    Color BackdropAt(Rectangle where_){
      try{
        Rectangle box=Box;
        if(box.Width<=0||box.Height<=0||shown==null)return Color.FromArgb(245,247,240);
        float sx=shown.Width/(float)box.Width, sy=shown.Height/(float)box.Height;
        Rectangle cut=Rectangle.Round(new RectangleF((where_.Left-box.Left)*sx,(where_.Top-box.Top)*sy,
                                                     Math.Max(1,where_.Width*sx),Math.Max(1,where_.Height*sy)));
        cut.Intersect(new Rectangle(0,0,shown.Width,shown.Height));
        if(cut.Width<1||cut.Height<1)return Color.FromArgb(245,247,240);
        long r=0,g=0,b=0,n=0;
        int stepX=Math.Max(1,cut.Width/12), stepY=Math.Max(1,cut.Height/12);
        for(int y=cut.Top;y<cut.Bottom;y+=stepY)
          for(int x=cut.Left;x<cut.Right;x+=stepX){
            Color c=shown.GetPixel(x,y);r+=c.R;g+=c.G;b+=c.B;n++;
          }
        if(n==0)return Color.FromArgb(245,247,240);
        return Color.FromArgb((int)(r/n),(int)(g/n),(int)(b/n));
      }catch{return Color.FromArgb(245,247,240);}
    }
    Rectangle SizeGrip(){
      if(editor==null)return Rectangle.Empty;
      return new Rectangle(editor.Right-2,editor.Bottom-2,14,14);
    }
    // 지우기 손잡이. 오른쪽 위. 고르고 있는 이 글상자만 지운다.
    Rectangle DropGrip(){
      if(editor==null)return Rectangle.Empty;
      return new Rectangle(editor.Right-2,editor.Top-14,14,14);
    }
    void DropEditing(){
      if(editor==null)return;
      int index=editing;
      RichTextBox gone=editor;editor=null;editing=-1;
      Controls.Remove(gone);gone.Dispose();
      if(index>=0&&index<marks.Count)marks.RemoveAt(index);
      Focus();Flash("글상자를 지웠습니다");Invalidate();
    }
    // 글상자에서 고른 부분이 있으면 그 부분만, 없으면 글 전체의 색을 바꾼다.
    void PaintSelection(Color colour){
      if(editor==null||editing<0||editing>=marks.Count)return;
      int start=editor.SelectionStart,len=editor.SelectionLength;
      pendingInk=colour;
      if(len>0)editor.SelectionColor=colour;
      else {
        editor.Select(0,editor.TextLength);editor.SelectionColor=colour;
        marks[editing].Ink=colour;
      }
      HarvestTints();
      // 고른 부분이 없으면 커서를 제자리에 두고 이어서 칠 색을 새 색으로 못박는다.
      if(len==0){editor.Select(start,0);editor.SelectionColor=colour;}
      editor.Focus();
      Invalidate();
    }
    // 색 고르개. 이 핀에만 걸리는 창이라 발표 전체가 멈추지 않는다.
    void OpenPalette(){
      using(ColorDialog pick=new ColorDialog{Color=InkKit.Custom,FullOpen=true,AnyColor=true}){
        if(pick.ShowDialog(this)!=DialogResult.OK)return;
        InkKit.Custom=pick.Color;
        inkIndex=InkKit.CustomIndex;
        PaintSelection(pick.Color);
      }
      Invalidate();
    }
    void OpenEditor(int index){
      if(index<0||index>=marks.Count||marks[index].Kind!=4)return;
      CloseEditor(true);
      editing=index;
      Rectangle box=Box;
      float sx=box.Width/(float)Math.Max(shown.Width,1), sy=box.Height/(float)Math.Max(shown.Height,1);
      Mark mark=marks[index];
      SizeF size=TextSize(mark,sx);
      Point at=new Point((int)(box.Left+mark.From.X*sx),(int)(box.Top+mark.From.Y*sy));
      textTop=at;
      // 서식 글상자라야 고른 블록만 색을 바꿀 수 있다.
      editor=new RichTextBox{
        BorderStyle=BorderStyle.None,WordWrap=false,ScrollBars=RichTextBoxScrollBars.None,
        DetectUrls=false,ShortcutsEnabled=true,
        Font=TextFace(mark.Size,sx),ForeColor=mark.Ink,
        Location=at,Size=new Size(Math.Max((int)size.Width+10,48),Math.Max((int)size.Height,16)),
        Text=mark.Text};
      // 글자마다 담아 둔 색을 되살린다.
      for(int i=0;i<editor.TextLength&&i<mark.Tints.Count;i++){
        editor.Select(i,1);editor.SelectionColor=mark.Tints[i];
      }
      editor.Select(editor.TextLength,0);
      editor.SelectionColor=mark.Ink;
      pendingInk=mark.Ink;
      editor.BackColor=BackdropAt(new Rectangle(at,new Size(Math.Max((int)size.Width+10,48),Math.Max((int)size.Height,16))));
      editor.TextChanged+=delegate{EditorGrew();};
      editor.KeyDown+=delegate(object sender,KeyEventArgs e){
        if(e.KeyCode==Keys.Escape){e.Handled=true;e.SuppressKeyPress=true;CloseEditor(true);}
      };
      Controls.Add(editor);editor.BringToFront();
      Activate();editor.Focus();
      editor.SelectionStart=editor.Text.Length;
      EditorGrew();Invalidate();
    }
    // 줄이 늘면 아래로 자란다. 왼쪽 위 자리는 그대로 둔다.
    // 글상자가 들고 있는 글자색을 표시로 옮긴다. 색을 바꾼 블록이 그대로 그림에 남는다.
    void HarvestTints(){
      if(editor==null||editing<0||editing>=marks.Count)return;
      harvesting=true;
      int keepStart=editor.SelectionStart,keepLen=editor.SelectionLength;
      List<Color> picked=new List<Color>(editor.TextLength);
      for(int i=0;i<editor.TextLength;i++){
        editor.Select(i,1);
        picked.Add(editor.SelectionColor);
      }
      editor.Select(keepStart,keepLen);
      if(keepLen==0&&pendingInk!=Color.Empty)editor.SelectionColor=pendingInk;
      marks[editing].Tints=picked;
      harvesting=false;
    }
    void EditorGrew(){
      if(editor==null||editing<0||editing>=marks.Count||harvesting)return;
      marks[editing].Text=editor.Text;
      Rectangle box=Box;
      float sx=box.Width/(float)Math.Max(shown.Width,1), sy=box.Height/(float)Math.Max(shown.Height,1);
      SizeF size=TextSize(marks[editing],sx);
      editor.Location=textTop;
      editor.Size=new Size(Math.Max((int)size.Width+10,48),Math.Max((int)size.Height,16));
      editor.BackColor=BackdropAt(editor.Bounds);
      marks[editing].From=new PointF((editor.Left-box.Left)/Math.Max(sx,0.0001f),(editor.Top-box.Top)/Math.Max(sy,0.0001f));
      Invalidate();
    }
    void CloseEditor(bool keep){
      if(editor==null)return;
      HarvestTints();
      string body=editor.Text;int index=editing;
      RichTextBox gone=editor;editor=null;editing=-1;
      Controls.Remove(gone);gone.Dispose();
      if(index>=0&&index<marks.Count){
        if(keep&&body.Trim().Length>0)marks[index].Text=body;
        else marks.RemoveAt(index);
      }
      Focus();Invalidate();
    }
    void SetTextSize(int index,float wanted){
      if(index<0||index>=marks.Count)return;
      marks[index].Size=Math.Max(8f,Math.Min(200f,wanted));
      if(editing==index&&editor!=null){
        float sx=Box.Width/(float)Math.Max(shown.Width,1);
        Font old=editor.Font;editor.Font=TextFace(marks[index].Size,sx);old.Dispose();
        EditorGrew();
      }
      Invalidate();
    }
    void MoveText(int index,PointF place){
      if(index<0||index>=marks.Count)return;
      marks[index].From=place;
      if(editing==index){
        Rectangle box=Box;
        float sx=box.Width/(float)Math.Max(shown.Width,1), sy=box.Height/(float)Math.Max(shown.Height,1);
        textTop=new Point((int)(box.Left+place.X*sx),(int)(box.Top+place.Y*sy));
        EditorGrew();
      }
      Invalidate();
    }
    // 모자이크는 그 자리 픽셀을 잘게 부숴 미리 만들어 둔다. 그리기는 그 다음부터 가볍다.
    Bitmap MosaicTile(RectangleF area){
      Rectangle cut=Rectangle.Round(area);
      cut.Intersect(new Rectangle(0,0,shown.Width,shown.Height));
      if(cut.Width<4||cut.Height<4)return null;
      try{
        using(Bitmap piece=shown.Clone(cut,shown.PixelFormat)){
          int w=Math.Max(2,cut.Width/14),h=Math.Max(2,cut.Height/14);
          Bitmap small=new Bitmap(w,h);
          using(Graphics g=Graphics.FromImage(small)){
            g.InterpolationMode=InterpolationMode.HighQualityBicubic;
            g.DrawImage(piece,0,0,w,h);
          }
          return small;
        }
      }catch{return null;}
    }
    // 그리기 도구 줄. 아래 두 줄에 붙인다.
    List<KeyValuePair<Rectangle,string>> InkHits(){
      Rectangle box=Box;
      List<KeyValuePair<Rectangle,string>> out_=new List<KeyValuePair<Rectangle,string>>();
      int big=24,small=20,gap=3,wide=52;   // 마침 단추는 글자를 넣어 넓게 둔다
      int x=box.Left+4,top=box.Bottom-4-small-gap-big;
      out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,top,big,big),"pick"));x+=big+gap;
      for(int i=0;i<InkKit.Tools.Length;i++){out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,top,big,big),"t"+i));x+=big+gap;}
      x+=6;
      out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,top,big,big),"undo"));x+=big+gap;
      out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,top,wide,big),"done"));x+=wide+gap;
      out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,top,big,big),"cancel"));
      x=box.Left+4;int low=box.Bottom-4-small;
      for(int i=0;i<InkKit.Inks.Length;i++){out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,low,small,small),"c"+i));x+=small+gap;}
      x+=6;
      for(int i=0;i<InkKit.Hefts.Length;i++){out_.Add(new KeyValuePair<Rectangle,string>(new Rectangle(x,low,small,small),"h"+i));x+=small+gap;}
      return out_;
    }
    void InkTap(string act){
      if(act=="undo"){if(marks.Count>0){Mark last=marks[marks.Count-1];if(last.Tile!=null)last.Tile.Dispose();marks.RemoveAt(marks.Count-1);}}
      else if(act=="done"){EndDraw(true);return;}
      else if(act=="pick"){
        picking=true;chosen=-1;CloseEditor(true);
        Flash("그린 것을 눌러 고르고 · 끌어 옮기고 · 모퉁이로 크기 · Delete 로 지웁니다");Invalidate();return;
      }
      else if(act=="cancel"){                    // 모두 지우기. 그리기에서 나가지는 않는다.
        foreach(Mark mark in marks)if(mark.Tile!=null)mark.Tile.Dispose();
        marks.Clear();live=null;typing=-1;Flash("그린 것을 모두 지웠습니다");Invalidate();return;
      }
      else {
        int i=act.Length==2&&act[1]>='0'&&act[1]<='9'?act[1]-'0':-1;
        if(i<0)return;
        if(act[0]=='t'&&i<InkKit.Tools.Length){tool=i;picking=false;chosen=-1;}
        else if(act[0]=='c'&&i<InkKit.Inks.Length){
          inkIndex=i;
          if(i==InkKit.CustomIndex){OpenPalette();return;}
          PaintSelection(InkKit.Inks[i]);
        }
        else if(act[0]=='h'&&i<InkKit.Hefts.Length)heftIndex=i;
        else return;
      }
      Invalidate();
    }
    void InkBegin(Point point){
      PointF here=ToImage(point);
      float[] heft=InkKit.Hefts[Math.Min(heftIndex,InkKit.Hefts.Length-1)];
      Mark mark=new Mark{Kind=tool,Ink=InkKit.Inks[Math.Min(inkIndex,InkKit.Inks.Length-1)],
                         Width=heft[0],Size=heft[1],From=here,To=here};
      if(tool==0)mark.Points.Add(here);
      if(tool==4){marks.Add(mark);typing=marks.Count-1;Flash("글자를 입력하고 Enter");Invalidate();return;}
      live=mark;Invalidate();
    }
    void InkMove(Point point){
      if(live==null)return;
      PointF here=ToImage(point);
      if(live.Kind==0)live.Points.Add(here);else live.To=here;
      Invalidate();
    }
    void InkFinish(){
      if(live==null)return;
      Mark mark=live;live=null;
      if(mark.Kind==3)mark.Tile=MosaicTile(mark.Box);
      bool enough=mark.Kind==0?mark.Points.Count>1:(mark.Box.Width>3||mark.Box.Height>3);
      if(enough)marks.Add(mark);else if(mark.Tile!=null)mark.Tile.Dispose();
      Invalidate();
    }
    void PaintInk(Graphics g){
      Rectangle box=Box;
      // 고쳐 쓰는 중인 글상자에는 테두리와 크기 손잡이를 보여 준다.
      if(editor==null&&chosen>=0&&chosen<marks.Count){
        Rectangle frame=ChosenFrame();
        using(Pen edge=new Pen(Lime,1.5f)){edge.DashStyle=DashStyle.Dash;g.DrawRectangle(edge,frame);}
        using(SolidBrush fill=new SolidBrush(Lime))
        using(Pen ring=new Pen(Deep,1f))
          foreach(Rectangle grip in MarkGrips()){g.FillRectangle(fill,grip);g.DrawRectangle(ring,grip);}
        Rectangle kill=ChosenDropGrip();
        using(SolidBrush fill=new SolidBrush(Color.FromArgb(204,71,56)))g.FillRectangle(fill,kill);
        using(SolidBrush ink=new SolidBrush(Color.White))
        using(Font tiny=new Font("Malgun Gothic",7,FontStyle.Bold))
          g.DrawString("✕",tiny,ink,kill,new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center});
      }
      if(editor!=null){
        // 테두리는 그리지 않는다. 커서와 두 손잡이만으로 자리를 알 수 있다.
        StringFormat centre=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center};
        using(Font tiny=new Font("Malgun Gothic",7,FontStyle.Bold)){
          Rectangle grip=SizeGrip();
          using(SolidBrush fill=new SolidBrush(Lime))g.FillRectangle(fill,grip);
          using(Pen mark=new Pen(Deep,1.2f))g.DrawRectangle(mark,grip);
          using(SolidBrush ink=new SolidBrush(Deep))g.DrawString("⇲",tiny,ink,grip,centre);
          Rectangle drop=DropGrip();
          using(SolidBrush fill=new SolidBrush(Color.FromArgb(204,71,56)))g.FillRectangle(fill,drop);
          using(SolidBrush ink=new SolidBrush(Color.White))g.DrawString("✕",tiny,ink,drop,centre);
        }
      }
      Rectangle strip=new Rectangle(box.Left,box.Bottom-60,box.Width,60);
      using(SolidBrush back=new SolidBrush(Color.FromArgb(150,0,0,0)))g.FillRectangle(back,strip);
      StringFormat middle=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center};
      using(Font face=new Font("Malgun Gothic",10,FontStyle.Bold))
      using(Font small2=new Font("Malgun Gothic",8,FontStyle.Bold))
      foreach(KeyValuePair<Rectangle,string> hit in InkHits()){
        // 이름부터 가린다. "cancel" 은 c 로 시작해서 색 칩 "c0" 과 앞글자가 같다. 예전에는
        // 앞글자를 먼저 봐서 'a'-'0' = 49 를 색 번호로 읽었고, Inks[49] 에서 그리기를 켜는
        // 순간 바로 예외가 났다. 번호가 붙는 단추는 "c3" 처럼 딱 두 글자라는 점으로 가린다.
        string act=hit.Value;bool on=false,isColor=false;string glyph="";Color back=Color.FromArgb(40,255,255,255),face2=Color.White;
        int i=act.Length==2&&act[1]>='0'&&act[1]<='9'?act[1]-'0':-1;
        if(act=="undo")glyph="↶";
        else if(act=="pick"){glyph="↖";on=picking;}
        else if(act=="done"){glyph="✓ 마침";back=Lime;face2=Deep;}
        else if(act=="cancel")glyph="⌫";
        else if(i>=0&&act[0]=='t'&&i<InkKit.Tools.Length){on=!picking&&tool==i;glyph=InkKit.Tools[i];}
        else if(i>=0&&act[0]=='c'&&i<InkKit.Inks.Length){back=InkKit.Inks[i];on=inkIndex==i;isColor=true;}
        else if(i>=0&&act[0]=='h'&&i<InkKit.Hefts.Length){on=heftIndex==i;glyph=new string[]{"·","•","●"}[i];}
        else continue;
        // 색 칩은 색 자체가 보여야 한다. 고른 표시는 테두리로만 한다.
        using(SolidBrush chip=new SolidBrush((isColor||!on)?back:Lime))g.FillRectangle(chip,hit.Key);
        if(on){
          if(isColor)using(Pen inner=new Pen(Color.White,2f))g.DrawRectangle(inner,Rectangle.Inflate(hit.Key,-3,-3));
          using(Pen edge=new Pen(Deep,1.5f))g.DrawRectangle(edge,hit.Key);
        }
        if(glyph.Length>0)using(SolidBrush ink=new SolidBrush(on?Deep:face2))g.DrawString(glyph,glyph.Length>2?small2:face,ink,hit.Key,middle);
      }
    }
    public PinForm(Bitmap image,Presenter owner,Point centre){
      source=image;host=owner;
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;DoubleBuffered=true;
      BackColor=Color.FromArgb(250,251,245);StartPosition=FormStartPosition.Manual;KeyPreview=true;
      Rectangle room=Screen.FromPoint(centre).WorkingArea;
      zoom=Math.Min(1f,Math.Min((room.Width-48f)/Math.Max(1,image.Width),(room.Height-48f)/Math.Max(1,image.Height)));
      BuildMenu();Rebuild();
      Natural=new Rectangle(centre.X-Natural.Width/2,centre.Y-Natural.Height/2,Natural.Width,Natural.Height);
      Clamp();Bounds=Natural;
    }
    Rectangle Box {get{return new Rectangle(Edge,Edge,Math.Max(1,ClientSize.Width-Edge*2),Math.Max(1,ClientSize.Height-Edge*2));}}
    string[] Glyphs {get{return cropping?CropTools:Tools;}}
    void Rebuild(){
      Bitmap made=new Bitmap(source);
      if(flipped)made.RotateFlip(RotateFlipType.RotateNoneFlipX);
      if(turns==1)made.RotateFlip(RotateFlipType.Rotate270FlipNone);
      else if(turns==2)made.RotateFlip(RotateFlipType.Rotate180FlipNone);
      else if(turns==3)made.RotateFlip(RotateFlipType.Rotate90FlipNone);
      if(shown!=null)shown.Dispose();
      shown=made;
      Refit();
    }
    void Refit(){
      int w=folded?220:Math.Max(40,(int)Math.Round(shown.Width*zoom))+Edge*2;
      int h=folded?32:Math.Max(40,(int)Math.Round(shown.Height*zoom))+Edge*2;
      int cx=Natural.Width==0?0:Natural.X+Natural.Width/2,cy=Natural.Height==0?0:Natural.Y+Natural.Height/2;
      Natural=new Rectangle(cx-w/2,cy-h/2,w,h);
      Clamp();Invalidate();
    }
    // 핀이 화면 밖으로 완전히 나가면 다시 잡을 수 없다. 늘 일부는 보이게 끌어 둔다.
    void Clamp(){
      Rectangle room=Screen.FromRectangle(Natural).WorkingArea;
      int x=Math.Min(Math.Max(Natural.X,room.Left-Natural.Width+60),room.Right-60);
      int y=Math.Min(Math.Max(Natural.Y,room.Top-Natural.Height+60),room.Bottom-40);
      Natural=new Rectangle(x,y,Natural.Width,Natural.Height);
    }
    // 확대 중에는 화면에 보이는 자리가 실제 창 자리와 다르다. 발표 쪽에서 매 프레임 불러 준다.
    public void Place(float magnify,int offsetX,int offsetY){
      if(magnify<=1.001f){if(Bounds!=Natural)Bounds=Natural;return;}
      int w=Math.Max(8,(int)Math.Round(Natural.Width/magnify));
      int h=Math.Max(8,(int)Math.Round(Natural.Height/magnify));
      int x=(int)Math.Round(Natural.X/magnify)+offsetX;
      int y=(int)Math.Round(Natural.Y/magnify)+offsetY;
      Rectangle wanted=new Rectangle(x,y,w,h);
      if(Bounds!=wanted)Bounds=wanted;
    }
    // 작은 핀에서는 단추가 다 들어가지 않는다. 들어가는 만큼만 그린다.
    Rectangle[] ToolRects(){
      int room=Box.Width-6;
      int fits=Math.Max(1,Math.Min(Glyphs.Length,(room+ToolGap)/(ToolSide+ToolGap)));
      int total=fits*ToolSide+(fits-1)*ToolGap;
      int x=Math.Max(Edge,ClientSize.Width-Edge-total),y=Edge;
      Rectangle[] boxes=new Rectangle[fits];
      for(int i=0;i<fits;i++){boxes[i]=new Rectangle(x,y,ToolSide,ToolSide);x+=ToolSide+ToolGap;}
      return boxes;
    }
    Rectangle[] CropCorners(){
      Rectangle a=cropBox;int g=Grip;
      return new Rectangle[]{
        new Rectangle(a.Left-g/2,a.Top-g/2,g,g),      // 0 왼쪽 위
        new Rectangle(a.Right-g/2,a.Top-g/2,g,g),     // 1 오른쪽 위
        new Rectangle(a.Right-g/2,a.Bottom-g/2,g,g),  // 2 오른쪽 아래
        new Rectangle(a.Left-g/2,a.Bottom-g/2,g,g)};  // 3 왼쪽 아래
    }
    void Flash(string text){
      note=text;
      if(noteTimer==null){noteTimer=new System.Windows.Forms.Timer{Interval=1600};noteTimer.Tick+=delegate{noteTimer.Stop();note="";Invalidate();};}
      noteTimer.Stop();noteTimer.Start();Invalidate();
    }
    protected override void OnPaint(PaintEventArgs e){
      Rectangle box=Box;
      if(folded){
        using(SolidBrush back=new SolidBrush(Color.FromArgb(235,Deep)))e.Graphics.FillRectangle(back,box);
        using(SolidBrush ink=new SolidBrush(Color.White))
          e.Graphics.DrawString("▣ 접은 핀 · 두 번 눌러 펼치기",new Font("Malgun Gothic",9,FontStyle.Bold),ink,box.X+8,box.Y+7);
      } else {
        e.Graphics.InterpolationMode=InterpolationMode.HighQualityBicubic;
        e.Graphics.DrawImage(shown,box);
        PaintMarks(e.Graphics,box);
        if(cropping)PaintCrop(e.Graphics,box);
        if(drawing)PaintInk(e.Graphics);
      }
      // 클릭 통과 중인 핀은 눌러도 반응하지 않는다. 테두리 색으로 그 사실을 계속 보여 준다.
      Color border=cropping?Lime:(through?Color.FromArgb(243,181,64):Lime);
      using(Pen edge=new Pen(border,Edge))
        e.Graphics.DrawRectangle(edge,new Rectangle(Edge/2,Edge/2,ClientSize.Width-Edge,ClientSize.Height-Edge));
      if((hovering||cropping)&&!folded&&!through&&!drawing){
        Rectangle[] boxes=ToolRects();
        using(Font face=new Font("Malgun Gothic",10,FontStyle.Bold)){
          StringFormat middle=new StringFormat{Alignment=StringAlignment.Center,LineAlignment=StringAlignment.Center};
          for(int i=0;i<boxes.Length;i++){
            bool go=cropping&&i==0;
            using(SolidBrush chip=new SolidBrush(go?Lime:Color.FromArgb(220,Deep)))e.Graphics.FillRectangle(chip,boxes[i]);
            using(SolidBrush ink=new SolidBrush(go?Deep:Color.White))e.Graphics.DrawString(Glyphs[i],face,ink,boxes[i],middle);
          }
        }
        using(SolidBrush strip=new SolidBrush(Color.FromArgb(190,0,0,0)))
        using(SolidBrush ink=new SolidBrush(Color.White))
        using(Font small=new Font("Malgun Gothic",8)){
          string tip=cropping?" 모퉁이를 끌어 자를 부분을 정하세요 · Enter 자르기 · Esc 취소 "
                             :" 끌어서 이동 · 휠 크기 · Ctrl+휠 투명 · 오른쪽 클릭 메뉴 ";
          SizeF size=e.Graphics.MeasureString(tip,small);
          e.Graphics.FillRectangle(strip,box.X,box.Bottom-size.Height,size.Width,size.Height);
          e.Graphics.DrawString(tip,small,ink,box.X,box.Bottom-size.Height);
        }
      }
      if(note.Length>0){
        using(SolidBrush strip=new SolidBrush(Color.FromArgb(235,Deep)))
        using(SolidBrush ink=new SolidBrush(Color.White))
        using(Font small=new Font("Malgun Gothic",9,FontStyle.Bold)){
          SizeF size=e.Graphics.MeasureString(note,small);
          e.Graphics.FillRectangle(strip,box.X+4,box.Y+4,size.Width+8,size.Height+4);
          e.Graphics.DrawString(note,small,ink,box.X+8,box.Y+6);
        }
      }
    }
    void PaintCrop(Graphics g,Rectangle box){
      Rectangle a=cropBox;
      using(SolidBrush dim=new SolidBrush(Color.FromArgb(140,0,0,0))){
        if(a.Width<1||a.Height<1)g.FillRectangle(dim,box);
        else {
          g.FillRectangle(dim,box.X,box.Y,box.Width,a.Top-box.Y);
          g.FillRectangle(dim,box.X,a.Bottom,box.Width,box.Bottom-a.Bottom);
          g.FillRectangle(dim,box.X,a.Top,a.Left-box.X,a.Height);
          g.FillRectangle(dim,a.Right,a.Top,box.Right-a.Right,a.Height);
        }
      }
      if(a.Width<1||a.Height<1)return;
      using(Pen edge=new Pen(Lime,2))g.DrawRectangle(edge,a);
      // 삼등분 선. 무엇을 남길지 눈으로 잡기 쉬워진다.
      using(Pen guide=new Pen(Color.FromArgb(90,Lime),1))
        for(int step=1;step<=2;step++){
          int fx=a.Left+a.Width*step/3,fy=a.Top+a.Height*step/3;
          g.DrawLine(guide,fx,a.Top,fx,a.Bottom);
          g.DrawLine(guide,a.Left,fy,a.Right,fy);
        }
      using(SolidBrush fill=new SolidBrush(Lime))
      using(Pen mark=new Pen(Deep,1.5f))
        foreach(Rectangle corner in CropCorners()){g.FillRectangle(fill,corner);g.DrawRectangle(mark,corner);}
      float ratio=shown.Width/(float)Math.Max(1,box.Width);
      string label=" "+(int)(a.Width*ratio)+" × "+(int)(a.Height*ratio)+" ";
      using(Font face=new Font("Malgun Gothic",8,FontStyle.Bold))
      using(SolidBrush back=new SolidBrush(Lime))
      using(SolidBrush ink=new SolidBrush(Deep)){
        SizeF size=g.MeasureString(label,face);
        float y=a.Top-size.Height-2<box.Y?a.Bottom+2:a.Top-size.Height-2;
        g.FillRectangle(back,a.Left,y,size.Width,size.Height);
        g.DrawString(label,face,ink,a.Left,y);
      }
    }
    protected override void OnMouseEnter(EventArgs e){hovering=true;Invalidate();base.OnMouseEnter(e);}
    protected override void OnMouseLeave(EventArgs e){hovering=false;Invalidate();base.OnMouseLeave(e);}
    protected override void OnMouseDown(MouseEventArgs e){
      if(e.Button!=MouseButtons.Left){base.OnMouseDown(e);return;}
      if(drawing){
        // 그리는 중에도 옮길 수 있어야 한다. Ctrl 을 누른 채 끌면 그린 그대로 따라온다.
        if((Control.ModifierKeys&Keys.Control)!=0){dragging=true;grab=Control.MousePosition;Focus();return;}
        foreach(KeyValuePair<Rectangle,string> hit in InkHits())if(hit.Key.Contains(e.Location)){InkTap(hit.Value);return;}
        // 크기 손잡이를 끌면 글자가 커지고 작아진다.
        if(picking){
          // 고른 것의 모퉁이를 잡으면 크기, 안쪽을 잡으면 이동, 빈 곳이면 고르기 해제.
          if(chosen>=0){
            Rectangle[] grips=MarkGrips();
            for(int i=0;i<grips.Length;i++)if(grips[i].Contains(e.Location)){
              stretching=chosen;stretchCorner=i;stretchFrom=MarkBox(marks[chosen]);return;
            }
            if(ChosenDropGrip().Contains(e.Location)){DropChosen();return;}
          }
          int found=MarkHit(e.Location);
          if(found<0){chosen=-1;Invalidate();return;}
          chosen=found;shifting=found;shiftGrab=e.Location;movedText=false;Invalidate();return;
        }
        if(editing>=0&&DropGrip().Contains(e.Location)){DropEditing();return;}
        if(editing>=0&&SizeGrip().Contains(e.Location)){
          sizingText=editing;sizeGrab=e.Location;sizeStart=marks[editing].Size;return;
        }
        // 이미 쓴 글을 누르면 고쳐 쓰고, 끌면 옮긴다.
        if(tool==4){
          int found=TextHit(e.Location);
          if(found>=0){
            if(editing!=found)CloseEditor(true);
            found=TextHit(e.Location);              // 빈 글상자가 지워졌을 수 있다
            if(found>=0){movingText=found;moveGrab=e.Location;moveFrom=marks[found].From;movedText=false;return;}
          }
        }
        CloseEditor(true);
        InkBegin(e.Location);return;
      }
      if((hovering||cropping)&&!folded&&!through){
        Rectangle[] boxes=ToolRects();
        for(int i=0;i<boxes.Length;i++)if(boxes[i].Contains(e.Location)){
          if(cropping){if(i==0)ApplyCrop();else CancelCrop();}
          else if(i==0)CloseSelf();else if(i==1)BeginDraw();else if(i==2)BeginCrop();else if(i==3)CopyOut();else if(i==4)SaveOut();else Rotate(1);
          return;
        }
      }
      if(cropping){CropGrab(e.Location);return;}
      if(e.Clicks>=2){Fold();return;}
      dragging=true;grab=Control.MousePosition;Focus();
    }
    protected override void OnMouseMove(MouseEventArgs e){
      if(drawing){
        if(dragging){
          Point now=Control.MousePosition;
          Natural=new Rectangle(Natural.X+now.X-grab.X,Natural.Y+now.Y-grab.Y,Natural.Width,Natural.Height);
          grab=now;Clamp();host.PlacePins();
        }
        else if(stretching>=0){
          PointF here=ToImage(e.Location);
          RectangleF box=stretchFrom;
          float fixedX=(stretchCorner==0||stretchCorner==2)?box.Right:box.Left;
          float fixedY=(stretchCorner==0||stretchCorner==1)?box.Bottom:box.Top;
          RectangleF wanted=new RectangleF(Math.Min(fixedX,here.X),Math.Min(fixedY,here.Y),
                                           Math.Abs(here.X-fixedX),Math.Abs(here.Y-fixedY));
          StretchMark(stretching,MarkBox(marks[stretching]),wanted);
          Invalidate();
        }
        else if(shifting>=0){
          if(Math.Abs(e.Location.X-shiftGrab.X)>2||Math.Abs(e.Location.Y-shiftGrab.Y)>2)movedText=true;
          PointF a=ToImage(shiftGrab),b=ToImage(e.Location);
          ShiftMark(shifting,b.X-a.X,b.Y-a.Y);
          shiftGrab=e.Location;Invalidate();
        }
        else if(sizingText>=0){
          // 오른쪽·아래로 끌수록 커진다.
          float step=(e.Location.X-sizeGrab.X)+(e.Location.Y-sizeGrab.Y);
          SetTextSize(sizingText,sizeStart+step*0.6f);
        }
        else if(movingText>=0){
          if(Math.Abs(e.Location.X-moveGrab.X)>2||Math.Abs(e.Location.Y-moveGrab.Y)>2)movedText=true;
          PointF a=ToImage(moveGrab),b=ToImage(e.Location);
          MoveText(movingText,new PointF(moveFrom.X+b.X-a.X,moveFrom.Y+b.Y-a.Y));
        }
        else if(live!=null)InkMove(e.Location);
        base.OnMouseMove(e);return;
      }
      if(cropping){if(grabbed>=0)CropMove(e.Location);base.OnMouseMove(e);return;}
      if(dragging){
        Point now=Control.MousePosition;
        // 확대 중에도 커서가 보이는 자리는 실제 자리와 같다(커서를 축으로 잘라 내기 때문).
        // 그래서 실제 이동량을 그대로 더하면 보이는 대로 끌린다.
        Natural=new Rectangle(Natural.X+now.X-grab.X,Natural.Y+now.Y-grab.Y,Natural.Width,Natural.Height);
        grab=now;Clamp();host.PlacePins();
      }
      base.OnMouseMove(e);
    }
    protected override void OnMouseUp(MouseEventArgs e){
      if(drawing){
        if(stretching>=0){int which=stretching;stretching=-1;stretchCorner=-1;RemakeTile(which);base.OnMouseUp(e);return;}
        if(shifting>=0){
          int which=shifting;bool moved=movedText;shifting=-1;RemakeTile(which);
          // 글상자는 제자리에서 떼면 고쳐 쓰기로 들어간다.
          if(!moved&&which<marks.Count&&marks[which].Kind==4)OpenEditor(which);
          base.OnMouseUp(e);return;
        }
        if(sizingText>=0){sizingText=-1;base.OnMouseUp(e);return;}
        if(movingText>=0){
          int which=movingText;bool moved=movedText;movingText=-1;
          // 제자리에서 뗐으면 옮긴 것이 아니라 고쳐 쓰겠다는 뜻이다.
          if(!moved&&editing!=which)OpenEditor(which);
          base.OnMouseUp(e);return;
        }
        if(dragging)dragging=false;else InkFinish();base.OnMouseUp(e);return;
      }
      dragging=false;grabbed=-1;base.OnMouseUp(e);}
    protected override void OnMouseWheel(MouseEventArgs e){
      if(cropping||drawing)return;
      if((Control.ModifierKeys&Keys.Control)!=0)SetShade(Opacity+(e.Delta>0?.06:-.06));
      else SetZoom(zoom*(e.Delta>0?1.06f:1/1.06f));
    }
    protected override void OnKeyDown(KeyEventArgs e){
      if(drawing){
        // 글상자가 열려 있으면 키는 글상자 것이다. KeyPreview 때문에 여기로 먼저 오므로
        // 반드시 그냥 흘려보내야 한다. 그러지 않으면 Enter 가 줄바꿈이 아니라 마침이 된다.
        if(editing>=0){base.OnKeyDown(e);return;}
        // 고른 것이 있으면 Delete 로 지운다.
        if(picking&&chosen>=0&&(e.KeyCode==Keys.Delete||e.KeyCode==Keys.Back)){
          DropChosen();e.Handled=true;e.SuppressKeyPress=true;return;
        }
        // 나가는 길은 모두 '그린 것을 남기고' 나간다. 그래야 그대로 옮길 수 있다.
        if(e.KeyCode==Keys.Enter||e.KeyCode==Keys.Escape)EndDraw(true);
        else if(e.KeyCode==Keys.Z){if(marks.Count>0){Mark last=marks[marks.Count-1];if(last.Tile!=null)last.Tile.Dispose();marks.RemoveAt(marks.Count-1);}}
        else if(e.KeyCode==Keys.P)tool=0;
        else if(e.KeyCode==Keys.O)tool=1;
        else if(e.KeyCode==Keys.L)tool=2;
        else if(e.KeyCode==Keys.M)tool=3;
        else if(e.KeyCode==Keys.T)tool=4;
        else {base.OnKeyDown(e);return;}
        Invalidate();e.Handled=true;e.SuppressKeyPress=true;return;
      }
      if(cropping){
        if(e.KeyCode==Keys.Enter)ApplyCrop();
        else if(e.KeyCode==Keys.Escape)CancelCrop();
        else {base.OnKeyDown(e);return;}
        e.Handled=true;e.SuppressKeyPress=true;return;
      }
      if(e.KeyCode==Keys.Escape)CloseSelf();
      else if(e.KeyCode==Keys.Space)Fold();
      else if(e.KeyCode==Keys.X)BeginCrop();
      else if(e.KeyCode==Keys.D)BeginDraw();
      else if(e.KeyCode==Keys.D1)Rotate(-1);
      else if(e.KeyCode==Keys.D2)Rotate(1);
      else if(e.KeyCode==Keys.D3){flipped=!flipped;Rebuild();}
      else if(e.KeyCode==Keys.D0)ResetAll();
      else if(e.KeyCode==Keys.C)CopyOut();
      else if(e.KeyCode==Keys.S)SaveOut();
      else if(e.KeyCode==Keys.T)SetThrough(true);
      else {base.OnKeyDown(e);return;}
      e.Handled=true;e.SuppressKeyPress=true;
    }
    void BuildMenu(){
      ContextMenuStrip menu=new ContextMenuStrip();
      menu.Items.Add("그리기 · 표시하기 (d)",null,delegate{BeginDraw();});
      menu.Items.Add("모퉁이로 잘라내기 (x)",null,delegate{BeginCrop();});
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("복사 (c)",null,delegate{CopyOut();});
      menu.Items.Add("캐퍼이미지 폴더에 저장 (s)",null,delegate{SaveOut();});
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("왼쪽으로 회전 (1)",null,delegate{Rotate(-1);});
      menu.Items.Add("오른쪽으로 회전 (2)",null,delegate{Rotate(1);});
      menu.Items.Add("좌우 뒤집기 (3)",null,delegate{flipped=!flipped;Rebuild();});
      menu.Items.Add("크기·투명도 원래대로 (0)",null,delegate{ResetAll();});
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("접기·펼치기 (Space)",null,delegate{Fold();});
      menu.Items.Add("클릭 통과 (t)",null,delegate{SetThrough(true);});
      menu.Items.Add(new ToolStripSeparator());
      menu.Items.Add("이 핀 닫기 (Esc)",null,delegate{CloseSelf();});
      menu.Items.Add("모든 핀 닫기",null,delegate{host.ClearPins();});
      ContextMenuStrip=menu;
    }
    // 모퉁이로 잘라내기 ------------------------------------------------------
    void BeginCrop(){
      if(through||folded||drawing)return;
      cropping=true;cropBox=Box;grabbed=-1;Focus();Invalidate();
    }
    void CancelCrop(){cropping=false;grabbed=-1;Invalidate();}
    void CropGrab(Point point){
      grabFrom=point;grabBox=cropBox;
      Rectangle[] corners=CropCorners();
      for(int i=0;i<corners.Length;i++)if(corners[i].Contains(point)){grabbed=i;return;}
      if(cropBox.Contains(point)){grabbed=4;return;}
      // 바깥을 끌면 그 자리에서 새로 잡는다.
      grabbed=5;cropBox=new Rectangle(point,Size.Empty);
    }
    void CropMove(Point point){
      Rectangle limit=Box;
      int x=Math.Min(Math.Max(point.X,limit.Left),limit.Right);
      int y=Math.Min(Math.Max(point.Y,limit.Top),limit.Bottom);
      int l=cropBox.Left,t=cropBox.Top,r=cropBox.Right,b=cropBox.Bottom;
      if(grabbed==0){l=x;t=y;r=grabBox.Right;b=grabBox.Bottom;}
      else if(grabbed==1){l=grabBox.Left;t=y;r=x;b=grabBox.Bottom;}
      else if(grabbed==2){l=grabBox.Left;t=grabBox.Top;r=x;b=y;}
      else if(grabbed==3){l=x;t=grabBox.Top;r=grabBox.Right;b=y;}
      else if(grabbed==4){
        int dx=x-grabFrom.X,dy=y-grabFrom.Y;
        l=grabBox.Left+dx;t=grabBox.Top+dy;
        l=Math.Min(Math.Max(l,limit.Left),limit.Right-grabBox.Width);
        t=Math.Min(Math.Max(t,limit.Top),limit.Bottom-grabBox.Height);
        r=l+grabBox.Width;b=t+grabBox.Height;
      }
      else {l=Math.Min(grabFrom.X,x);t=Math.Min(grabFrom.Y,y);r=Math.Max(grabFrom.X,x);b=Math.Max(grabFrom.Y,y);}
      // 뒤집힌 사각형은 정상 방향으로 되돌린다.
      if(r<l){int swap=l;l=r;r=swap;}
      if(b<t){int swap=t;t=b;b=swap;}
      Rectangle next=Rectangle.FromLTRB(l,t,r,b);
      next.Intersect(limit);
      cropBox=next;Invalidate();
    }
    void ApplyCrop(){
      if(!cropping)return;
      Rectangle limit=Box,a=cropBox;
      a.Intersect(limit);
      if(a.Width<10||a.Height<10){Flash("자를 부분이 너무 작습니다");return;}
      // 화면 상자 좌표를 그림 좌표로 옮긴다. 둘 다 위에서 아래로 가므로 뒤집을 것이 없다.
      float across=shown.Width/(float)Math.Max(1,limit.Width),down=shown.Height/(float)Math.Max(1,limit.Height);
      Rectangle inImage=new Rectangle(
        (int)Math.Round((a.Left-limit.Left)*across),(int)Math.Round((a.Top-limit.Top)*down),
        (int)Math.Round(a.Width*across),(int)Math.Round(a.Height*down));
      inImage.Intersect(new Rectangle(0,0,shown.Width,shown.Height));
      if(inImage.Width<1||inImage.Height<1){Flash("자르지 못했습니다");return;}
      Bitmap piece;
      try{piece=shown.Clone(inImage,shown.PixelFormat);}catch{Flash("자르지 못했습니다");return;}
      // 자른 결과가 새 원본이 된다. 회전은 이미 반영되어 있으므로 되돌린다.
      Bitmap old=source;
      source=piece;turns=0;flipped=false;cropping=false;grabbed=-1;
      Rebuild();
      if(old!=null)old.Dispose();
      host.PlacePins();
      Flash("잘랐습니다 · "+inImage.Width+"×"+inImage.Height);
    }
    public void SetZoom(float wanted){
      Rectangle room=Screen.FromRectangle(Natural).WorkingArea;
      float biggest=Math.Min(6f,Math.Max(1f,Math.Min(room.Width/(float)Math.Max(1,shown.Width),room.Height/(float)Math.Max(1,shown.Height))));
      float smallest=40f/Math.Max(shown.Width,shown.Height);
      zoom=Math.Max(smallest,Math.Min(biggest,wanted));Refit();host.PlacePins();
    }
    void SetShade(double wanted){Opacity=Math.Max(.25,Math.Min(1,wanted));Flash("불투명 "+Math.Round(Opacity*100)+"%");}
    // 클릭 통과 중에는 창이 마우스를 받지 못한다. 앱이 가로챈 휠을 이리로 넘긴다.
    public void NudgeShade(double by){SetShade(Opacity+by);}
    void Rotate(int step){turns=((turns+step)%4+4)%4;Rebuild();host.PlacePins();}
    void Fold(){if(cropping||drawing)return;folded=!folded;Refit();host.PlacePins();}
    void ResetAll(){zoom=1;turns=0;flipped=false;folded=false;cropping=false;Opacity=1;SetThrough(false);Rebuild();host.PlacePins();}
    // 통과를 켜면 이 핀은 더 이상 클릭을 받지 않는다. 되돌리는 길은 트레이 메뉴뿐이다.
    // WinForms 는 Opacity 를 건드릴 때마다 GWL_EXSTYLE 를 이 CreateParams 값으로 통째로
    // 다시 쓴다. SetThrough 가 손으로 켜 둔 WS_EX_TRANSPARENT 는 그 자리에서 지워졌다 —
    // 통과 핀 위에서 휠을 **한 칸** 굴리는 순간(투명도 변경) 클릭 통과가 꺼져 버렸다.
    // 실기기 확인: 굴리기 전 exStyle=0x00010028, 굴린 뒤 0x00090008 (0x20 이 사라짐).
    // 여기에 실어 두면 WinForms 가 다시 써도 통과 비트가 살아남는다.
    protected override CreateParams CreateParams {
      get{CreateParams p=base.CreateParams;if(through)p.ExStyle|=0x20;return p;}
    }
    public void SetThrough(bool wanted){
      through=wanted;
      if(wanted){cropping=false;if(drawing)EndDraw(false);}
      IntPtr style=Native.GetWindowLongPtr(Handle,-20);
      long value=style.ToInt64();
      if(wanted)value|=0x20;else value&=~0x20L;
      Native.SetWindowLongPtr(Handle,-20,new IntPtr(value));
      if(wanted)Flash("클릭 통과 켜짐 · 휠로 투명도 · 트레이에서 해제");
      Invalidate();
      host.PublishState();
    }
    void CopyOut(){try{Clipboard.SetImage(shown);Flash("클립보드에 복사");}catch{Flash("복사하지 못했습니다");}}
    void SaveOut(){string name=Presenter.SavePin(shown);Flash(name==null?"저장하지 못했습니다":Presenter.ShotsName+" · "+name);}
    void CloseSelf(){host.Forget(this);Close();}
    protected override void OnFormClosed(FormClosedEventArgs e){
      foreach(Mark mark in marks)if(mark.Tile!=null)mark.Tile.Dispose();
      if(shown!=null)shown.Dispose();
      if(source!=null)source.Dispose();
      if(noteTimer!=null)noteTimer.Dispose();
      base.OnFormClosed(e);
    }
  }
  sealed class SnipForm:Form {
    readonly Bitmap shot;
    Point? origin;Point current;
    public Action<Rectangle> Done;public Action Cancelled;
    public SnipForm(Bitmap image,Rectangle area){
      shot=image;
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;DoubleBuffered=true;
      StartPosition=FormStartPosition.Manual;Bounds=area;Cursor=Cursors.Cross;KeyPreview=true;
    }
    Rectangle Selection {
      get{
        if(!origin.HasValue)return Rectangle.Empty;
        Point a=origin.Value;
        return new Rectangle(Math.Min(a.X,current.X),Math.Min(a.Y,current.Y),Math.Abs(a.X-current.X),Math.Abs(a.Y-current.Y));
      }
    }
    protected override void OnPaint(PaintEventArgs e){
      e.Graphics.DrawImage(shot,0,0,ClientSize.Width,ClientSize.Height);
      Rectangle box=Selection;
      using(SolidBrush dim=new SolidBrush(Color.FromArgb(115,0,0,0))){
        if(box.Width<1||box.Height<1)e.Graphics.FillRectangle(dim,ClientRectangle);
        else {
          e.Graphics.FillRectangle(dim,0,0,ClientSize.Width,box.Top);
          e.Graphics.FillRectangle(dim,0,box.Bottom,ClientSize.Width,ClientSize.Height-box.Bottom);
          e.Graphics.FillRectangle(dim,0,box.Top,box.Left,box.Height);
          e.Graphics.FillRectangle(dim,box.Right,box.Top,ClientSize.Width-box.Right,box.Height);
        }
      }
      if(box.Width>0&&box.Height>0){
        using(Pen edge=new Pen(Color.FromArgb(222,243,155),2))e.Graphics.DrawRectangle(edge,box);
        string label=" "+box.Width+" × "+box.Height+" ";
        using(Font face=new Font("Malgun Gothic",9,FontStyle.Bold))
        using(SolidBrush back=new SolidBrush(Color.FromArgb(222,243,155)))
        using(SolidBrush ink=new SolidBrush(Color.Black)){
          SizeF size=e.Graphics.MeasureString(label,face);
          float y=box.Top-size.Height-4<0?box.Bottom+4:box.Top-size.Height-4;
          e.Graphics.FillRectangle(back,box.Left,y,size.Width,size.Height);
          e.Graphics.DrawString(label,face,ink,box.Left,y);
        }
      }
      using(Font face=new Font("Malgun Gothic",11,FontStyle.Bold))
      using(SolidBrush back=new SolidBrush(Color.FromArgb(200,0,0,0)))
      using(SolidBrush ink=new SolidBrush(Color.White)){
        string guide=" 끌어서 화면 조각을 고르세요 · 고르면 바로 핀으로 붙습니다 · Esc 또는 오른쪽 클릭 취소 ";
        SizeF size=e.Graphics.MeasureString(guide,face);
        e.Graphics.FillRectangle(back,40,40,size.Width,size.Height);
        e.Graphics.DrawString(guide,face,ink,40,40);
      }
    }
    protected override void OnMouseDown(MouseEventArgs e){
      if(e.Button==MouseButtons.Right){if(Cancelled!=null)Cancelled();return;}
      origin=e.Location;current=e.Location;Invalidate();
    }
    protected override void OnMouseMove(MouseEventArgs e){if(origin.HasValue){current=e.Location;Invalidate();}}
    protected override void OnMouseUp(MouseEventArgs e){
      if(e.Button!=MouseButtons.Left)return;
      Rectangle box=Selection;
      if(box.Width>=6&&box.Height>=6){if(Done!=null)Done(box);}
      else if(Cancelled!=null)Cancelled();
    }
    protected override void OnKeyDown(KeyEventArgs e){
      if(e.KeyCode==Keys.Escape){if(Cancelled!=null)Cancelled();e.Handled=true;e.SuppressKeyPress=true;return;}
      base.OnKeyDown(e);
    }
    protected override void OnFormClosed(FormClosedEventArgs e){if(shot!=null)shot.Dispose();base.OnFormClosed(e);}
  }
  // 안내 창은 숨어 있어도 메시지 루프를 지닌 창이라, 전역 단축키를 받는 자리로 쓴다.
  // 녹화 표시기 — 녹화 중임을 알리는 작은 창. SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE) 로
  // **화면 녹화에 담기지 않는다.** 아무 곳이나 끌어 옮길 수 있고, 둔 자리를 기억한다.
  // 녹화 중 화면에 뜨는 동그란 카메라 창. 표시기와 달리 이 창은 화면 녹화에 **담겨야** 하므로
  // SetWindowDisplayAffinity 를 걸지 않는다. 카메라를 열지 못하면 Ready 가 오지 않고,
  // 그것을 본 확장이 예전처럼 영상 안에 동그라미를 합쳐 넣는다(둘 다 뜨는 일이 없다).
  sealed class CameraForm:Form {
    static string SpotFile{get{return Path.Combine(Presenter.Box,"camera-spot.txt");}}
    Windows.Media.Capture.MediaCapture capture;
    Windows.Media.Capture.Frames.MediaFrameReader reader;
    Bitmap latest;
    readonly object gate=new object();
    DateTime lastFrame=DateTime.MinValue;
    bool told=false;
    public Action Ready;
    public CameraForm(){
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
      Size=new Size(220,220);BackColor=Color.Black;
      SetStyle(ControlStyles.OptimizedDoubleBuffer|ControlStyles.AllPaintingInWmPaint|ControlStyles.UserPaint,true);
      MouseDown+=Grab;
    }
    // 둥근 모양은 창 손잡이가 생긴 뒤에 건다. OpenCamera 가 첫 그림을 받으려고 손잡이를
    // 미리 만들어 두므로, 생성자에 있던 것을 이 자리로 옮겼다 — 그 길로도 모양이 살아 있게.
    protected override void OnHandleCreated(EventArgs e){
      base.OnHandleCreated(e);
      Region=System.Drawing.Region.FromHrgn(Native.CreateRoundRectRgn(0,0,Width+1,Height+1,Width,Height));
    }
    protected override bool ShowWithoutActivation{get{return true;}}
    void Grab(object sender,MouseEventArgs e){
      if(e.Button!=MouseButtons.Left)return;
      Native.ReleaseCapture();Native.SendMessage(Handle,0xA1,2,0);   // WM_NCLBUTTONDOWN · HTCAPTION
      try{File.WriteAllText(SpotFile,Location.X+","+Location.Y);}catch{}
    }
    public void Place(Screen wanted=null){
      string saved=null;try{saved=File.Exists(SpotFile)?File.ReadAllText(SpotFile):null;}catch{}
      // 녹화 중인 모니터(모르면 마우스가 있는 모니터)에 띄운다. 예전에는 늘 주 모니터라
      // 다른 모니터를 녹화하면 화면 밖에 떴다. 지난번 자리는 그 모니터 안일 때만 쓴다.
      Rectangle area=(wanted??Screen.FromPoint(Cursor.Position)).WorkingArea;
      System.Drawing.Point spot=new System.Drawing.Point(area.Right-Width-28,area.Bottom-Height-28);
      if(saved!=null){
        string[] parts=saved.Split(',');int x,y;
        if(parts.Length==2&&int.TryParse(parts[0],out x)&&int.TryParse(parts[1],out y)){
          Rectangle box=new Rectangle(x,y,Width,Height);
          if(area.IntersectsWith(box))spot=new System.Drawing.Point(x,y);
        }
      }
      Location=spot;
    }
    // 카메라를 연다. 무엇 하나라도 어긋나면 조용히 포기한다 — 녹화 자체를 막으면 안 된다.
    public async void Begin(string name){
      try{
        var all=await Windows.Devices.Enumeration.DeviceInformation.FindAllAsync(Windows.Devices.Enumeration.DeviceClass.VideoCapture);
        Windows.Devices.Enumeration.DeviceInformation chosen=null;
        if(!string.IsNullOrEmpty(name))
          foreach(var one in all)
            if(one.Name==name||name.Contains(one.Name)){chosen=one;break;}
        if(chosen==null&&all.Count>0)chosen=all[0];
        if(chosen==null)return;
        capture=new Windows.Media.Capture.MediaCapture();
        var settings=new Windows.Media.Capture.MediaCaptureInitializationSettings();
        settings.VideoDeviceId=chosen.Id;
        settings.StreamingCaptureMode=Windows.Media.Capture.StreamingCaptureMode.Video;
        settings.MemoryPreference=Windows.Media.Capture.MediaCaptureMemoryPreference.Cpu;
        try{ await capture.InitializeAsync(settings); }
        catch{
          // 탭·창을 녹화할 때는 확장(Chrome)도 같은 카메라를 열어 영상 안에 합친다. 윈도우는
          // 기본이 '혼자 쓰기' 라 그때 실패할 수 있다. 같이 읽기로 한 번 더 해 본다.
          capture=new Windows.Media.Capture.MediaCapture();
          settings.SharingMode=Windows.Media.Capture.MediaCaptureSharingMode.SharedReadOnly;
          await capture.InitializeAsync(settings);
        }
        Windows.Media.Capture.Frames.MediaFrameSource source=null;
        foreach(var pair in capture.FrameSources)
          if(pair.Value.Info.SourceKind==Windows.Media.Capture.Frames.MediaFrameSourceKind.Color){source=pair.Value;break;}
        if(source==null)return;
        reader=await capture.CreateFrameReaderAsync(source,Windows.Media.MediaProperties.MediaEncodingSubtypes.Bgra8);
        reader.FrameArrived+=Arrived;
        await reader.StartAsync();
      }catch{}
    }
    void Arrived(Windows.Media.Capture.Frames.MediaFrameReader sender,Windows.Media.Capture.Frames.MediaFrameArrivedEventArgs args){
      try{
        // 초당 15장이면 눈에 충분하다. 매 장 그림을 만들면 메모리만 축낸다.
        if((DateTime.UtcNow-lastFrame).TotalMilliseconds<66)return;
        lastFrame=DateTime.UtcNow;
        using(var frame=sender.TryAcquireLatestFrame()){
          if(frame==null||frame.VideoMediaFrame==null)return;
          var soft=frame.VideoMediaFrame.SoftwareBitmap;
          if(soft==null)return;
          Bitmap made=Convert(soft);
          if(made==null)return;
          lock(gate){if(latest!=null)latest.Dispose();latest=made;}
        }
        if(IsHandleCreated)BeginInvoke(new Action(delegate{
          Invalidate();
          if(!told){told=true;if(Ready!=null)Ready();}
        }));
      }catch{}
    }
    static Bitmap Convert(Windows.Graphics.Imaging.SoftwareBitmap soft){
      Windows.Graphics.Imaging.SoftwareBitmap use=soft;
      if(soft.BitmapPixelFormat!=Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8||soft.BitmapAlphaMode!=Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied)
        use=Windows.Graphics.Imaging.SoftwareBitmap.Convert(soft,Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8,Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied);
      int w=use.PixelWidth,h=use.PixelHeight;
      var buffer=new Windows.Storage.Streams.Buffer((uint)(w*h*4));
      use.CopyToBuffer(buffer);
      byte[] bytes;Windows.Security.Cryptography.CryptographicBuffer.CopyToByteArray(buffer,out bytes);
      Bitmap made=new Bitmap(w,h,System.Drawing.Imaging.PixelFormat.Format32bppPArgb);
      var data=made.LockBits(new Rectangle(0,0,w,h),System.Drawing.Imaging.ImageLockMode.WriteOnly,made.PixelFormat);
      Marshal.Copy(bytes,0,data.Scan0,bytes.Length);
      made.UnlockBits(data);
      if(use!=soft)use.Dispose();
      return made;
    }
    protected override void OnPaint(PaintEventArgs e){
      e.Graphics.Clear(Color.Black);
      lock(gate){
        if(latest!=null){
          e.Graphics.InterpolationMode=InterpolationMode.HighQualityBilinear;
          int side=Math.Min(latest.Width,latest.Height);
          Rectangle from=new Rectangle((latest.Width-side)/2,(latest.Height-side)/2,side,side);
          // 내 모습은 거울이 익숙하다. 좌우를 뒤집어 그린다.
          var kept=e.Graphics.Save();
          e.Graphics.TranslateTransform(Width,0);
          e.Graphics.ScaleTransform(-1,1);
          e.Graphics.DrawImage(latest,new Rectangle(0,0,Width,Height),from,GraphicsUnit.Pixel);
          e.Graphics.Restore(kept);
        }
      }
      using(Pen ring=new Pen(Color.FromArgb(223,243,156),4))
        e.Graphics.DrawEllipse(ring,2,2,Width-5,Height-5);
    }
    protected override void OnFormClosed(FormClosedEventArgs e){
      try{if(reader!=null){reader.FrameArrived-=Arrived;reader.StopAsync().GetAwaiter();reader.Dispose();reader=null;}}catch{}
      try{if(capture!=null){capture.Dispose();capture=null;}}catch{}
      lock(gate){if(latest!=null){latest.Dispose();latest=null;}}
      base.OnFormClosed(e);
    }
  }
  sealed class BadgeForm:Form {
    public Action<string> Pressed;
    readonly Label clock=new Label(),note=new Label();
    readonly Button pause=new Button(),stop=new Button(),cancel=new Button();
    readonly System.Windows.Forms.Timer blink=new System.Windows.Forms.Timer();
    readonly Panel dot=new Panel();
    bool on=true,paused=false;
    public BadgeForm(){
      FormBorderStyle=FormBorderStyle.None;ShowInTaskbar=false;TopMost=true;StartPosition=FormStartPosition.Manual;
      Size=new Size(268,46);BackColor=Color.FromArgb(15,41,33);
      Region=System.Drawing.Region.FromHrgn(Native.CreateRoundRectRgn(0,0,Width,Height,Height,Height));
      dot.SetBounds(14,17,11,11);dot.BackColor=Color.FromArgb(255,90,74);
      dot.Region=System.Drawing.Region.FromHrgn(Native.CreateRoundRectRgn(0,0,11,11,11,11));
      clock.SetBounds(32,12,64,20);clock.ForeColor=Color.White;clock.Font=new Font("Consolas",13,FontStyle.Bold);clock.Text="00:00";
      note.SetBounds(32,29,100,13);note.ForeColor=Color.FromArgb(170,190,175);note.Font=new Font("Malgun Gothic",7.5f);note.Text="녹화 중";
      int at=134;
      foreach(var item in new[]{new object[]{pause,"❙❙","pause"},new object[]{stop,"■","stop"},new object[]{cancel,"✕","cancel"}}){
        Button button=(Button)item[0];string which=(string)item[2];
        button.Text=(string)item[1];button.SetBounds(at,9,40,28);at+=44;
        button.FlatStyle=FlatStyle.Flat;button.FlatAppearance.BorderSize=0;
        button.BackColor=Color.FromArgb(15,41,33);button.ForeColor=which=="stop"?Color.FromArgb(255,115,98):Color.White;
        button.Font=new Font("Segoe UI Symbol",10,FontStyle.Bold);button.TabStop=false;
        button.Click+=delegate{ if(Pressed!=null)Pressed(which); };
        Controls.Add(button);
      }
      Controls.Add(dot);Controls.Add(clock);Controls.Add(note);
      // 배경 아무 곳이나 끌면 창이 따라온다.
      foreach(Control c in new Control[]{this,clock,note,dot})c.MouseDown+=Grab;
      blink.Interval=700;blink.Tick+=delegate{ if(paused)return; on=!on;dot.BackColor=on?Color.FromArgb(255,90,74):Color.FromArgb(90,45,40); };blink.Start();
    }
    void Grab(object sender,MouseEventArgs e){
      if(e.Button!=MouseButtons.Left)return;
      Native.ReleaseCapture();Native.SendMessage(Handle,0xA1,2,0);   // WM_NCLBUTTONDOWN · HTCAPTION
      Save();
    }
    protected override void OnHandleCreated(EventArgs e){
      base.OnHandleCreated(e);
      // 이 한 줄이 “녹화되지 않는 창” 을 만든다. 안 되는 윈도우에서는 그냥 평범한 창이 된다.
      try{Native.SetWindowDisplayAffinity(Handle,Native.ExcludeFromCapture);}catch{}
    }
    protected override bool ShowWithoutActivation{get{return true;}}   // 누르던 창의 초점을 빼앗지 않는다
    public void Show(string time,bool isPaused,bool camera,Screen wanted=null){
      paused=isPaused;
      clock.Text=time;note.Text=(isPaused?"잠시 멈춤":"녹화 중")+(camera?" · 카메라":"");
      dot.BackColor=isPaused?Color.FromArgb(245,165,36):Color.FromArgb(255,90,74);
      pause.Text=isPaused?"▶":"❙❙";
      if(!Visible){Place(wanted);Show();}
    }
    void Place(Screen wanted=null){
      string saved=null;try{saved=File.Exists(SpotFile)?File.ReadAllText(SpotFile):null;}catch{}
      // 녹화 중인 모니터(모르면 마우스가 있는 모니터)에 띄운다. 지난번 자리는 그 안일 때만.
      Rectangle area=(wanted??Screen.FromPoint(Cursor.Position)).WorkingArea;
      Point spot=new Point(area.Right-Width-28,area.Bottom-Height-28);
      if(saved!=null){
        string[] parts=saved.Split(',');int x,y;
        if(parts.Length==2&&int.TryParse(parts[0],out x)&&int.TryParse(parts[1],out y)){
          Rectangle box=new Rectangle(x,y,Width,Height);
          if(area.IntersectsWith(box))spot=new Point(x,y);
        }
      }
      Location=spot;
    }
    static string SpotFile{get{return Path.Combine(Presenter.Box,"badge-spot.txt");}}
    void Save(){try{File.WriteAllText(SpotFile,Location.X+","+Location.Y);}catch{}}
    protected override void OnFormClosing(FormClosingEventArgs e){Save();blink.Stop();base.OnFormClosing(e);}
  }
  sealed class HelpForm:Form {
    public Action<int> Pressed;
    protected override void WndProc(ref Message m){
      if(m.Msg==0x0312&&Pressed!=null)Pressed((int)m.WParam);   // WM_HOTKEY
      base.WndProc(ref m);
    }
  }
  // 사이드바가 "focus=ctrl+alt+F;snip=ctrl+alt+S;…" 꼴로 보낸다. 맥과 윈도우는 운영체제가
  // 미리 가져간 조합이 서로 달라, 사이드바가 이 컴퓨터용 한 벌만 골라 보낸다. 받은 글은
  // %LOCALAPPDATA%\BrowserSheriff\keys.txt 에 남긴다. 앱만 따로 켰을 때도 지난번에 정한
  // 조합이 그대로 들어야 한다.
  struct Combo {
    public int Mods;   // 1 Ctrl · 2 Alt · 4 Shift · 8 Win
    public int Key;    // 가상 키 코드
    public string Label;
    public bool Matches(int mods,int key){return mods==Mods&&key==Key;}
    // 사이드바의 hotNorm 과 한 글자도 다르지 않아야 한다(ctrl+alt+shift+cmd, 글자는 대문자).
    // 가상 키 코드는 A~Z·0~9 에서 그 글자의 ASCII 값과 같다.
    public string Text(){
      return ((Mods&1)!=0?"ctrl+":"")+((Mods&2)!=0?"alt+":"")+((Mods&4)!=0?"shift+":"")+((Mods&8)!=0?"cmd+":"")+((char)Key).ToString();
    }
  }
  static class Keys2 {
    public static readonly string[] Order={"present","focus","snip","clip","clear","unlock"};
    static readonly System.Collections.Generic.Dictionary<string,string> Fallback=
      new System.Collections.Generic.Dictionary<string,string>{
        {"present","ctrl+alt+P"},{"focus","ctrl+alt+F"},{"snip","ctrl+alt+S"},{"clip","ctrl+alt+V"},
        {"clear","ctrl+alt+D"},{"unlock","ctrl+alt+T"}};
    // RegisterHotKey 가 쓰는 깃발: MOD_ALT 1 · MOD_CONTROL 2 · MOD_SHIFT 4 · MOD_WIN 8.
    // 우리 쪽 번호(Ctrl 1 · Alt 2 · Shift 4 · Win 8)와 Ctrl·Alt 가 서로 바뀌어 있다.
    public static uint Flags(int mods){
      return (uint)(((mods&1)!=0?2:0)|((mods&2)!=0?1:0)|((mods&4)!=0?4:0)|((mods&8)!=0?8:0));
    }
    // 글자와 숫자만 받는다. F1~F12 는 도움말·창 닫기 같은 기능이 이미 쓰고 있다.
    static readonly System.Collections.Generic.Dictionary<string,int> Codes=
      new System.Collections.Generic.Dictionary<string,int>{{"A",0x41},{"B",0x42},{"C",0x43},{"D",0x44},{"E",0x45},{"F",0x46},{"G",0x47},{"H",0x48},{"I",0x49},{"J",0x4A},{"K",0x4B},{"L",0x4C},{"M",0x4D},{"N",0x4E},{"O",0x4F},{"P",0x50},{"Q",0x51},{"R",0x52},{"S",0x53},{"T",0x54},{"U",0x55},{"V",0x56},{"W",0x57},{"X",0x58},{"Y",0x59},{"Z",0x5A}, {"0",0x30},{"1",0x31},{"2",0x32},{"3",0x33},{"4",0x34},{"5",0x35},{"6",0x36},{"7",0x37},{"8",0x38},{"9",0x39},};
    public static bool Parse(string text,out Combo combo){
      combo=new Combo();
      int mods=0;string main=null;
      foreach(string piece in (text??"").Split('+')){
        string part=piece.Trim().ToLowerInvariant();
        if(part.Length==0)continue;
        if(part=="ctrl"||part=="control")mods|=1;
        else if(part=="alt"||part=="option"||part=="opt")mods|=2;
        else if(part=="shift")mods|=4;
        else if(part=="cmd"||part=="meta"||part=="win")mods|=8;
        else if(main!=null)return false;
        else main=part.ToUpperInvariant();
      }
      int key;
      if(main==null||!Codes.TryGetValue(main,out key))return false;
      string label=((mods&1)!=0?"Ctrl+":"")+((mods&2)!=0?"Alt+":"")+((mods&4)!=0?"Shift+":"")+((mods&8)!=0?"Win+":"")+main;
      combo=new Combo{Mods=mods,Key=key,Label=label};
      return true;
    }
    // 앱이 지금 실제로 듣고 있는 조합. 사이드바가 이것을 보고 어긋나면 다시 보낸다.
    public static string Text(System.Collections.Generic.Dictionary<string,Combo> set){
      var parts=new System.Collections.Generic.List<string>();
      foreach(string name in Order)parts.Add(name+"="+set[name].Text());
      return string.Join(";",parts);
    }
    // 못 읽은 것은 기본 조합으로 되돌린다. 단축키가 하나도 없는 상태로 남지 않게 한다.
    public static System.Collections.Generic.Dictionary<string,Combo> Read(string text){
      var given=new System.Collections.Generic.Dictionary<string,string>();
      foreach(string entry in (text??"").Split(';')){
        int cut=entry.IndexOf('=');
        if(cut>0)given[entry.Substring(0,cut).Trim()]=entry.Substring(cut+1);
      }
      var made=new System.Collections.Generic.Dictionary<string,Combo>();
      foreach(string name in Order){
        Combo combo;string wanted;
        if(!given.TryGetValue(name,out wanted)||!Parse(wanted,out combo))Parse(Fallback[name],out combo);
        made[name]=combo;
      }
      return made;
    }
  }
  sealed class Presenter:ApplicationContext {
    NotifyIcon tray;HelpForm help;Label helpBody;PointerWindow pointer;SpotlightWindow spot;
    System.Windows.Forms.Timer timer;
    Native.Hook mouseCallback,keyCallback;IntPtr mouseHook,keyHook;
    bool active=false,initialized=false;float zoom=1;bool exiting=false;bool focus=false;int focusRadius=170; RegisteredWaitHandle activationWait;
    string ringHex="#deef9b";int ringSpan=104;double focusDim=.55;
    System.Collections.Generic.Dictionary<string,Combo> combos=Keys2.Read("");
    BadgeForm badge;
    RegisteredWaitHandle recorderWait;
    CameraForm cameraView;
    bool snipSave=false;
    // 확장이 알려 준 '지금 녹화 중인 화면'. 표시기와 카메라 창을 그 모니터에 띄운다.
    string recordDisplay="";
    // 확장에서 1초마다 소식이 온다. 한동안 조용하면 녹화 창이 사라진 것이다 — 스스로 거둔다.
    System.Windows.Forms.Timer badgeWatch;
    // 클릭 통과 핀 위에서 휠로 투명도를 바꾸기 위한 가로채기(통과 핀이 있을 때만 건다).
    IntPtr wheelHook=IntPtr.Zero;
    Native.Hook wheelCallback;
    public const string RecorderEvent="Local\\BrowserSheriffRecorder";
    public static string RecorderFile {get{return Path.Combine(Box,"recorder.json");}}
    public static string RecorderButtonFile {get{return Path.Combine(Box,"recorder-button.json");}}
    public static string KeyFile {get{return Path.Combine(Box,"keys.txt");}}
    // 화면이 그대로면 다시 그리지 않는다. MagSetFullscreenTransform 은 바탕화면 전체를 다시
    // 합성하는 무거운 호출이라, 실기기에서는 그래픽 카드가 받아 주지만 가상 머신(VMware 등)
    // 에서는 CPU 가 통째로 떠안는다. 예전에는 16ms 타이머와 마우스 훅이 둘 다 이걸 무조건
    // 불러, 마우스를 가만히 둬도 초당 60번씩 화면을 다시 만들었다.
    int lastX=int.MinValue,lastY=int.MinValue;float drawnZoom=-1;bool drawnFocus=false;int drawnRadius=-1;
    bool viewDirty=true;string trayText="";
    void Redraw(){viewDirty=true;UpdateView();}
    readonly System.Collections.Generic.List<PinForm> pins=new System.Collections.Generic.List<PinForm>();
    SnipForm snipper;float snipZoom=1;bool snipFocus=false;int lastOffX=0,lastOffY=0;
    const int MaxPins=12;
    // 사이드바의 도크는 확장 -> 네이티브 호스트 -> 이 앱으로 명령을 넘긴다. macOS 는
    // DistributedNotificationCenter 를 쓰지만 Windows 에는 같은 것이 없다. 그래서 이름 있는
    // 이벤트로 깨우고, 명령과 상태는 %LOCALAPPDATA%\BrowserSheriff 의 작은 JSON 두 개로
    // 주고받는다. 호스트는 이벤트를 열 수 있는지로 앱이 떠 있는지도 함께 판단한다.
    public const string CommandEvent="Local\\BrowserSheriffPresenterCommand";
    public static string Box {
      get{
        string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BrowserSheriff");
        try{Directory.CreateDirectory(dir);}catch{}
        return dir;
      }
    }
    public static string CommandFile {get{return Path.Combine(Box,"command.json");}}
    public static string StateFile {get{return Path.Combine(Box,"state.json");}}
    // 화면에 보이고 서로 견주는 버전. Application.ProductVersion 은 csproj 의
    // InformationalVersion 을 돌려주는데 그 값이 0.31.0 에 멈춰 있어, 0.34.0 을 깔고도
    // 앱과 state.json 과 점검표가 모두 “0.31.0” 이라고 말했다. 그래서 옛 앱이 그대로
    // 남아 있어도 점검표의 ‘설치된 앱이 최신인지’ 가 늘 정상으로 나왔다(실제로 확인).
    // FileVersion 은 csproj 의 <Version> 을 따라 제대로 올라가므로 그쪽을 쓴다.
    public static string Ver {get{return VerOf(SelfInfo);}}
    // 같은 버전이라도 다른 빌드인지 가리는 값. 점검표의 최신 여부는 이것으로 견준다.
    public static string Build {
      get{
        System.Diagnostics.FileVersionInfo me=SelfInfo;
        return (me==null?"":me.FileVersion+" "+me.ProductVersion);
      }
    }
    static System.Diagnostics.FileVersionInfo SelfInfo {
      get{try{return System.Diagnostics.FileVersionInfo.GetVersionInfo(Application.ExecutablePath);}catch{return null;}}
    }
    // 0.34.0.0 → 0.34.0. 읽지 못하면 예전처럼 ProductVersion 을 쓴다.
    public static string VerOf(System.Diagnostics.FileVersionInfo info){
      try{
        string file=(info==null?null:info.FileVersion);
        if(!string.IsNullOrEmpty(file)){
          string[] bits=file.Split('.');
          if(bits.Length>=3)return bits[0]+"."+bits[1]+"."+bits[2];
          return file;
        }
      }catch{}
      return Application.ProductVersion.Split('+')[0];
    }
    public static string BuildOf(System.Diagnostics.FileVersionInfo info){
      return (info==null?"":info.FileVersion+" "+info.ProductVersion);
    }
    RegisteredWaitHandle commandWait;
    public Presenter(EventWaitHandle activation,EventWaitHandle command,EventWaitHandle recorder,bool startRequested,bool quiet){
      tray=new NotifyIcon{Icon=SystemIcons.Information,Text="다있쌤 · 발표 v"+(Presenter.Ver),Visible=true};
      ContextMenuStrip menu=new ContextMenuStrip();menu.Items.Add("발표 시작",null,delegate{Start();});menu.Items.Add("발표 종료 · 원래 크기",null,delegate{Stop();});menu.Items.Add("집중 모드 켜기 · 끄기",null,delegate{ToggleFocus();});menu.Items.Add(new ToolStripSeparator());menu.Items.Add("화면 조각 잘라 붙이기",null,delegate{BeginSnip();});menu.Items.Add("화면 조각 저장하기 · 복사",null,delegate{BeginSnip(true);});menu.Items.Add("클립보드 붙이기",null,delegate{PinClipboard();});menu.Items.Add("녹화 카메라 창 미리 보기",null,delegate{PreviewCamera();});menu.Items.Add("클릭 통과 켜기 · 끄기",null,delegate{ThroughPins();});menu.Items.Add("클릭 통과 모두 해제",null,delegate{UnlockPins();});menu.Items.Add("핀 모두 닫기",null,delegate{ClearPins();});menu.Items.Add(new ToolStripSeparator());menu.Items.Add("사용 방법",null,delegate{ShowHelp();});menu.Items.Add("앱 종료",null,delegate{ExitThread();});tray.ContextMenuStrip=menu;tray.DoubleClick+=delegate{ShowHelp();};
      combos=Keys2.Read(StoredKeys());
      Application.ApplicationExit+=delegate{Cleanup();};SystemEvents.SessionEnding+=SessionEnding;SystemEvents.DisplaySettingsChanged+=DisplayChanged;SystemEvents.PowerModeChanged+=PowerChanged;SystemEvents.SessionSwitch+=SessionSwitch;
      // 사이드바가 부른 것이라면 도움말 창을 띄우지 않는다. 명령만 조용히 받는다.
      if(quiet)MakeHelp();else ShowHelp();
      activationWait=ThreadPool.RegisterWaitForSingleObject(activation,delegate(object state,bool timedOut){Dispatch(delegate{Start();if(active)help.Hide();});},null,Timeout.Infinite,false);
      commandWait=ThreadPool.RegisterWaitForSingleObject(command,delegate(object state,bool timedOut){Dispatch(TakeCommand);},null,Timeout.Infinite,false);
      recorderWait=ThreadPool.RegisterWaitForSingleObject(recorder,delegate(object state,bool timedOut){Dispatch(TakeRecorder);},null,Timeout.Infinite,false);
      PublishState();
      // 사이드바가 우리를 띄운 것이라면 명령이 이미 적혀 있다. 이벤트를 놓쳤어도 집어 간다.
      if(quiet)help.BeginInvoke((Action)TakeCommand);
      if(startRequested)help.BeginInvoke((Action)(()=>{Start();if(active)help.Hide();}));
    }
    void Dispatch(Action action){
      if(help==null||help.IsDisposed||exiting)return;
      if(!help.IsHandleCreated){IntPtr unused=help.Handle;}
      if(help.InvokeRequired)help.BeginInvoke(action);else action();
    }
    void SessionEnding(object sender,SessionEndingEventArgs args){Dispatch(Stop);}
    void SessionSwitch(object sender,SessionSwitchEventArgs args){if(args.Reason==SessionSwitchReason.SessionLock||args.Reason==SessionSwitchReason.RemoteDisconnect||args.Reason==SessionSwitchReason.ConsoleDisconnect)Dispatch(Stop);}
    // 디스플레이 구성은 모니터가 잠들거나 DPI 가 바뀌어도 '바뀌었다' 고 알려 온다. 예전에는
    // 발표 중이 아니어도 모달 알림을 띄워 일을 멈춰 세웠다(사용자 보고). 발표 중일 때만,
    // 그것도 막지 않는 트레이 알림으로 알린다. 핀 자리는 언제나 다시 잡아 준다(맥과 같다).
    void DisplayChanged(object sender,EventArgs args){
      if(help==null||help.IsDisposed)return;
      help.BeginInvoke((Action)(()=>{
        PlacePins();
        if(!active)return;
        Stop();
        Tell("디스플레이가 바뀌어 발표를 끝냈습니다");
      }));
    }
    void PowerChanged(object sender,PowerModeChangedEventArgs args){if(args.Mode==PowerModes.Suspend)Dispatch(Stop);}
    void ShowHelp(){MakeHelp();help.Show();help.Activate();}
    // help 창은 명령을 옮겨 줄 UI 스레드 자리이기도 하다. 숨겨 두더라도 반드시 만들어 둔다.
    // 안내 창과 트레이 글씨는 사용자가 정한 조합을 그대로 보여 준다.
    string HelpText(){
      return combos["present"].Label+": 발표 시작 · 종료(앱이 켜져 있으면 늘 듣습니다)\n"
        +"Control + Alt + 휠: 1~4배 실시간 확대\nControl + Alt + Shift + 휠: 집중 모드 원 크기\n"
        +combos["focus"].Label+": 집중 모드 켜기 · 끄기\nEsc: 원래대로, 한 번 더 누르면 발표 종료\n"
        +"\n[화면 조각 핀] 트레이 메뉴 또는 발표 중 단축키\n"
        +combos["snip"].Label+": 영역을 끌어 잘라 화면에 붙이기\n"
        +combos["clip"].Label+": 클립보드의 그림·글을 붙이기\n"
        +combos["clear"].Label+": 핀 모두 닫기\n"
        +combos["unlock"].Label+": 클릭 통과 모두 해제\n"
        +"단축키는 사이드바 ‘발표 → 단축키 안내 · 바꾸기’ 에서 바꿉니다.\n"
        +"핀 위에서 휠 크기, Ctrl+휠 투명도, 오른쪽 클릭 메뉴, Esc 닫기.\n"
        +"\n[모니터가 여러 대일 때]\n집중 모드·포인터 원·화면 조각 핀은 모든 모니터에서\n"
        +"됩니다. 다만 Windows 의 화면 확대 기능은 주 모니터만\n키울 수 있어(운영체제 제약), 다른 모니터에서는 확대가\n"
        +"걸리지 않습니다. 화면 녹화·업로드·계정 연결은 없습니다.";
    }
    // 사이드바가 보낸 단축키를 받아 둔다. 같은 값이면 안내 글을 다시 만들지 않는다.
    void SetHotkeys(string text){
      var next=Keys2.Read(text);
      bool same=true;
      foreach(string name in Keys2.Order)
        if(next[name].Mods!=combos[name].Mods||next[name].Key!=combos[name].Key)same=false;
      if(same)return;
      combos=next;
      try{File.WriteAllText(KeyFile,text,Encoding.UTF8);}catch{}
      if(helpBody!=null&&!helpBody.IsDisposed)helpBody.Text=HelpText();
      BindHotKeys();
      PublishState();
      trayText="";viewDirty=true;
    }
    static string StoredKeys(){try{return File.ReadAllText(KeyFile,Encoding.UTF8);}catch{return "";}}
    void MakeHelp(){
      if(help!=null&&!help.IsDisposed)return;
      help=new HelpForm{Text="다있쌤 · 발표 도우미 v"+(Presenter.Ver)+"   만든이 다있쌤 로디",Size=new Size(452,520),StartPosition=FormStartPosition.CenterScreen,BackColor=Color.FromArgb(250,251,245),Font=new Font("Malgun Gothic",10),MaximizeBox=false};
      Label title=new Label{Text="화면은 크게, 설명은 편안하게.",Location=new Point(24,22),Size=new Size(380,35),Font=new Font("Malgun Gothic",15,FontStyle.Bold)};
      helpBody=new Label{Text=HelpText(),Location=new Point(24,68),Size=new Size(396,318)};
      Label body=helpBody;
      Button start=new Button{Text="발표 시작",Location=new Point(24,400),Size=new Size(170,40)};start.Click+=delegate{Start();if(active)help.Hide();};
      Button stop=new Button{Text="발표 종료",Location=new Point(211,400),Size=new Size(170,40)};stop.Click+=delegate{Stop();};help.Controls.AddRange(new Control[]{title,body,start,stop});help.FormClosing+=delegate(object s,FormClosingEventArgs e){if(!exiting){e.Cancel=true;help.Hide();}};
      help.Pressed=HotKey;
      // 창을 띄우지 않으면 핸들이 안 생긴다. 핸들이 없는 Control 은 InvokeRequired 가 false 를
      // 돌려주어, 사이드바 명령이 UI 스레드가 아니라 스레드풀에서 그대로 실행된다. 저수준 훅과
      // Forms 타이머는 부른 스레드의 메시지 루프에 매달리므로, 그러면 발표가 켜진 척만 하고
      // 아무 일도 일어나지 않는다. 숨어 있어도 핸들은 반드시 만들어 둔다.
      IntPtr unused=help.Handle;
      BindHotKeys();
    }
    // 발표 전에도 들어야 하는 단축키를 창에 붙인다. 발표 중에는 저수준 훅이 먼저 집어
    // 삼키므로(핀 단축키) 두 번 실행되지 않는다. 발표 시작 키는 훅이 그냥 흘려보내므로
    // 발표 중에 눌러도 여기로 와서 '종료' 가 된다.
    void BindHotKeys(){
      if(help==null||help.IsDisposed||!help.IsHandleCreated)return;
      for(int i=0;i<Keys2.Order.Length;i++)Native.UnregisterHotKey(help.Handle,i+1);
      for(int i=0;i<Keys2.Order.Length;i++){
        Combo combo=combos[Keys2.Order[i]];
        // 다른 프로그램이 이미 가진 조합이면 실패한다. 그때는 발표 중에만 듣게 된다.
        Native.RegisterHotKey(help.Handle,i+1,Keys2.Flags(combo.Mods)|0x4000,(uint)combo.Key);
      }
    }
    void HotKey(int id){
      string name=(id>=1&&id<=Keys2.Order.Length)?Keys2.Order[id-1]:null;
      if(name=="present"){if(active)Stop();else{Start();if(active)help.Hide();}}
      else if(name=="focus")ToggleFocus();
      else if(name=="snip")BeginSnip();
      else if(name=="clip")PinClipboard();
      else if(name=="clear")ClearPins();
      else if(name=="unlock")ThroughPins();
    }
    void Start(){
      if(active)return;
      if(!Native.MagInitialize()){MessageBox.Show("확대를 초기화하지 못했습니다. 64비트 Windows 10/11에서 실행하세요.");return;}initialized=true;
      float existing;int ex,ey;if(!Native.MagGetFullscreenTransform(out existing,out ex,out ey)||existing>1.01f){Native.MagUninitialize();initialized=false;MessageBox.Show("다른 확대 도구를 먼저 종료하세요.");return;}
      mouseCallback=MouseHook;keyCallback=KeyHook;IntPtr module=Native.GetModuleHandle(null);
      mouseHook=Native.SetWindowsHookEx(14,mouseCallback,module,0);keyHook=Native.SetWindowsHookEx(13,keyCallback,module,0);
      if(mouseHook==IntPtr.Zero||keyHook==IntPtr.Zero){Stop();MessageBox.Show("전역 마우스 입력을 연결하지 못했습니다.");return;}
      pointer=new PointerWindow();pointer.Ink=Colour(ringHex);pointer.Span=ringSpan;pointer.Shrink=1;pointer.Show();active=true;zoom=1;focus=false;
      lastX=int.MinValue;lastY=int.MinValue;drawnZoom=-1;drawnRadius=-1;viewDirty=true;trayText="";
      timer=new System.Windows.Forms.Timer{Interval=16};timer.Tick+=delegate{UpdateView();};timer.Start();Native.MagShowSystemCursor(true);UpdateView();PublishState();
    }
    IntPtr MouseHook(int code,IntPtr message,IntPtr data){
      // 조각 내기 화면이 떠 있는 동안은 멈춘 그림이라 배율을 바꿀 이유가 없다.
      if(snipper!=null)return Native.CallNextHookEx(mouseHook,code,message,data);
      if(code>=0&&active){
        if(message.ToInt32()==0x020A&&(Native.GetAsyncKeyState(0x11)&0x8000)!=0&&(Native.GetAsyncKeyState(0x12)&0x8000)!=0){
          Native.Mouse mouse=(Native.Mouse)Marshal.PtrToStructure(data,typeof(Native.Mouse));short delta=(short)(mouse.mouseData>>16);
          if(focus&&(Native.GetAsyncKeyState(0x10)&0x8000)!=0)focusRadius=Math.Max(70,Math.Min(460,focusRadius+(delta>0?12:-12)));
          else zoom=Math.Max(1,Math.Min(4,zoom+(delta > 0 ? .1f : -.1f)));
          UpdateView();return new IntPtr(1);
        }
        UpdateView();
      }return Native.CallNextHookEx(mouseHook,code,message,data);
    }
    IntPtr KeyHook(int code,IntPtr message,IntPtr data){
      if(snipper!=null)return Native.CallNextHookEx(keyHook,code,message,data);
      if(code>=0&&active&&message.ToInt32()==0x100){
        int key=Marshal.ReadInt32(data);
        // 지금 눌려 있는 수정 키. 정해 둔 것과 **정확히** 같을 때만 우리 단축키로 본다.
        // Ctrl+Alt+F 로 정했다면 Ctrl+Alt+Shift+F 는 다른 조합이고, Windows 키를 함께
        // 누른 것도 우리 것이 아니다(운영체제가 먼저 가져가야 한다).
        int mods=((Native.GetAsyncKeyState(0x11)&0x8000)!=0?1:0)
                |((Native.GetAsyncKeyState(0x12)&0x8000)!=0?2:0)
                |((Native.GetAsyncKeyState(0x10)&0x8000)!=0?4:0)
                |((((Native.GetAsyncKeyState(0x5B)|Native.GetAsyncKeyState(0x5C))&0x8000)!=0)?8:0);
        if(combos["focus"].Matches(mods,key)){ToggleFocus();return new IntPtr(1);}
        if(combos["snip"].Matches(mods,key)){Dispatch(BeginSnip);return new IntPtr(1);}
        if(combos["clip"].Matches(mods,key)){Dispatch(PinClipboard);return new IntPtr(1);}
        if(combos["clear"].Matches(mods,key)){Dispatch(ClearPins);return new IntPtr(1);}
        if(combos["unlock"].Matches(mods,key)){Dispatch(ThroughPins);return new IntPtr(1);}
        if(key==0x1B){
          // 핀을 고른 상태의 Esc 는 그 핀 하나만 닫는다. 여기서 삼키면 핀마다 닫을 길이 없다.
          if(Form.ActiveForm is PinForm)return Native.CallNextHookEx(keyHook,code,message,data);
          if(zoom>1||focus){zoom=1;SetFocusMode(false);UpdateView();}
          else Stop();
          return new IntPtr(1);
        }
      }
      return Native.CallNextHookEx(keyHook,code,message,data);
    }
    void ToggleFocus(){
      // 집중 모드는 화면을 키워야 그릴 수 있다. 발표를 먼저 켜고 이어서 집중 모드로 들어간다.
      // 예전에는 여기서 막는 경고창을 띄웠고, 그 창이 트레이 조작을 전부 삼켰다.
      if(!active){Start();if(!active)return;SetFocusMode(true);UpdateView();return;}
      SetFocusMode(!focus);UpdateView();
    }
    void SetFocusMode(bool wanted){
      if(focus==wanted)return;
      focus=wanted;
      viewDirty=true;
      if(!focus){if(spot!=null){spot.Close();spot.Dispose();spot=null;}PublishState();return;}
      PublishState();
      spot=new SpotlightWindow(Screen.FromPoint(Cursor.Position).Bounds,focusDim);spot.Show();viewDirty=true;
    }
    void UpdateView(){
      // 조각을 내는 동안에는 발표 표시를 숨겨 둔다. 여기서 막지 않으면 다음 틱에 도로 올라온다.
      if(!active||snipper!=null)return;Native.Point p;if(!Native.GetCursorPos(out p))return;
      if(!viewDirty&&p.X==lastX&&p.Y==lastY&&zoom==drawnZoom&&focus==drawnFocus&&focusRadius==drawnRadius)return;
      viewDirty=false;lastX=p.X;lastY=p.Y;drawnZoom=zoom;drawnFocus=focus;drawnRadius=focusRadius;
      // 모니터가 여러 대면 커서가 있는 모니터를 기준으로 삼는다. 예전에는 주 모니터를 벗어나면
      // 확대를 풀고 표시를 숨겨 버려서, 둘째 모니터에서는 아무것도 쓸 수 없었다.
      Screen here=Screen.FromPoint(new Point(p.X,p.Y));
      Rectangle stage=here.Bounds;
      // 집중 모드에서는 밝은 원이 이미 포인터 자리를 가리킨다. 포인터 원까지 그리면 두 겹이라 지저분하다.
      if(focus){if(pointer.Visible)pointer.Hide();}
      else if(!pointer.Visible)pointer.Show();
      Native.MagShowSystemCursor(true);
      if(spot!=null&&!spot.Visible)spot.Show();
      if(spot!=null)spot.Cover(stage);
      // Windows 의 전체 화면 확대(MagSetFullscreenTransform)는 **주 모니터만** 키운다.
      // 오프셋도 주 모니터 왼쪽 위를 기준으로 하는 값이다. 그래서 커서가 다른 모니터에
      // 있을 때 확대를 걸면, 보고 있지도 않은 주 모니터의 화면만 엉뚱하게 움직인다.
      // 그 사이에는 배율을 1로 두고, 포인터 원과 집중 모드만 그 모니터에서 쓴다.
      // (그 모니터에서도 확대하려면 Windows 디스플레이 설정에서 주 모니터로 바꾸면 된다.)
      bool onPrimary=here.Primary;
      float applied=onPrimary?zoom:1f;
      // Mouse-anchored crop: source point under the displayed pointer remains p.
      int x=onPrimary?(int)Math.Round(p.X*(1-1/zoom)):0;
      int y=onPrimary?(int)Math.Round(p.Y*(1-1/zoom)):0;
      if(!Native.MagSetFullscreenTransform(applied,x,y)){Stop();MessageBox.Show("확대에 실패하여 원래 화면으로 복원했습니다.");return;}
      lastOffX=x;lastOffY=y;PlacePins();
      pointer.Shrink=onPrimary?1/zoom:1f;pointer.Location=new Point(p.X-pointer.Half,p.Y-pointer.Half);
      // The overlay is magnified too, so shrink the hole by the same factor to keep it constant on screen.
      if(spot!=null){spot.Focus(new Point(p.X,p.Y),Math.Max(8,(int)Math.Round(focusRadius/(onPrimary?zoom:1f))));RaisePins();if(!focus)pointer.BringToFront();}
      // 트레이 글씨는 셸에 알림을 보내는 호출이다. 바뀔 때만 건드린다.
      string wanted=(!onPrimary&&zoom>1.01f)
        ? "다있쌤 · 확대는 주 모니터에서만 됩니다 · 집중 모드와 핀은 이 화면에서도 됩니다"
        : "다있쌤 "+zoom.ToString("0.0")+"×"+(focus?" · 집중":"")+" · Esc 종료 · "+combos["focus"].Label+" 집중";
      if(trayText!=wanted){trayText=wanted;tray.Text=wanted;}
    }
    void Stop(){
      active=false;zoom=1;if(timer!=null){timer.Stop();timer.Dispose();timer=null;}
      if(mouseHook!=IntPtr.Zero){Native.UnhookWindowsHookEx(mouseHook);mouseHook=IntPtr.Zero;}if(keyHook!=IntPtr.Zero){Native.UnhookWindowsHookEx(keyHook);keyHook=IntPtr.Zero;}
      if(initialized){Native.MagSetFullscreenTransform(1,0,0);Native.MagShowSystemCursor(true);Native.MagUninitialize();initialized=false;}
      if(pointer!=null){pointer.Close();pointer.Dispose();pointer=null;}
      if(spot!=null){spot.Close();spot.Dispose();spot=null;}focus=false;
      lastOffX=0;lastOffY=0;PlacePins();
      if(tray!=null)tray.Text="다있쌤 · 발표";
      PublishState();
    }
    // 사이드바가 읽는 현재 상태. 버튼이 켜졌는지 꺼졌는지를 이 파일 하나로 알린다.
    public void PublishState(){
      SyncWheelHook();
      int through=0;foreach(PinForm pin in pins)if(pin.Through)through++;
      try{
        File.WriteAllText(StateFile,JsonSerializer.Serialize(new{
          presenting=active,focus=focus,pins=pins.Count,through=through,hotkeys=active?4:0,keys=Keys2.Text(combos),badge=badge!=null&&!badge.IsDisposed,
          camera=cameraView!=null&&!cameraView.IsDisposed&&cameraView.Visible,
          version=Presenter.Ver,started=DateTime.Now.ToString("HH:mm:ss")}),Encoding.UTF8);
      }catch{}
    }
    // 이벤트로 깨어나 명령 파일을 읽는다. 값은 확장이 모두 문자열로 보낸다.
    void TakeCommand(){
      string raw;
      try{raw=File.ReadAllText(CommandFile,Encoding.UTF8);}catch{return;}
      string action=null,ring=null,ringSize=null,dim=null,at=null,keys=null;
      try{
        using(JsonDocument document=JsonDocument.Parse(raw)){
          JsonElement root=document.RootElement,node;
          if(root.TryGetProperty("action",out node))action=node.GetString();
          if(root.TryGetProperty("ring",out node))ring=node.GetString();
          if(root.TryGetProperty("ringSize",out node))ringSize=node.GetString();
          if(root.TryGetProperty("dim",out node))dim=node.GetString();
          if(root.TryGetProperty("at",out node))at=node.GetString();
          if(root.TryGetProperty("keys",out node))keys=node.GetString();
        }
      }catch{return;}
      // 오래된 명령은 무시한다. 다음에 앱을 직접 켤 때 옛 명령이 되살아나면 안 된다.
      long stamp;
      if(at!=null&&long.TryParse(at,NumberStyles.Integer,CultureInfo.InvariantCulture,out stamp)
         &&DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()-stamp>30000){try{File.Delete(CommandFile);}catch{}return;}
      // 같은 명령을 이벤트와 시작 때 두 번 실행하지 않도록 먼저 치운다.
      try{File.Delete(CommandFile);}catch{}
      float number;
      if(ring!=null)ringHex=ring;
      if(ringSize!=null&&float.TryParse(ringSize,NumberStyles.Float,CultureInfo.InvariantCulture,out number))ringSpan=(int)Math.Max(16,Math.Min(280,Math.Round(number*2)));
      if(dim!=null&&float.TryParse(dim,NumberStyles.Float,CultureInfo.InvariantCulture,out number))focusDim=Math.Max(0f,Math.Min(.9f,number));
      if(keys!=null)SetHotkeys(keys);
      ApplyKnobs();
      switch(action){
        case "start": Start(); break;
        case "stop": Stop(); break;
        case "focus-on": if(!focus)ToggleFocus(); break;
        case "focus-off": if(active&&focus)SetFocusMode(false); break;
        case "focus": ToggleFocus(); break;
        case "snip": BeginSnip(); break;
        // 도크의 ‘선택 영역 캡처’. 브라우저 탭이 아니라 화면 전체에서 고른다(다른 앱·다른 모니터도).
        case "snip-save": BeginSnip(true); break;
        case "pin-clip": PinClipboard(); break;
        case "pins-clear": ClearPins(); break;
        case "pins-unlock": UnlockPins(); break;
        case "pins-through": ThroughPins(); break;
      }
      if(active)UpdateView();
      PublishState();
    }
    // 확장이 녹화를 시작·갱신·끝낼 때 온다. 표시기 창은 화면 녹화에 담기지 않는다.
    void TakeRecorder(){
      string raw;
      try{raw=File.ReadAllText(RecorderFile,Encoding.UTF8);}catch{return;}
      try{File.Delete(RecorderFile);}catch{}
      string action="update",time="00:00",cameraName="",cameraView=null;bool paused=false,camera=false;
      try{
        using(JsonDocument document=JsonDocument.Parse(raw)){
          JsonElement root=document.RootElement,node;
          if(root.TryGetProperty("action",out node))action=node.GetString();
          if(root.TryGetProperty("time",out node))time=node.GetString();
          if(root.TryGetProperty("paused",out node))paused=node.GetString()=="1";
          if(root.TryGetProperty("camera",out node))camera=node.GetString()=="1";
          if(root.TryGetProperty("cameraView",out node))cameraView=node.GetString();
          if(root.TryGetProperty("cameraName",out node))cameraName=node.GetString();
          if(root.TryGetProperty("display",out node)){string where_=node.GetString();if(!string.IsNullOrEmpty(where_))recordDisplay=where_;}
        }
      }catch{return;}
      if(action=="hide"){
        StopBadgeWatch();
        if(badge!=null&&!badge.IsDisposed){badge.Close();badge.Dispose();}
        badge=null;CloseCamera();recordDisplay="";PublishState();return;
      }
      if(badge==null||badge.IsDisposed){
        badge=new BadgeForm();
        badge.Pressed=delegate(string which){
          // 앱과 확장은 서로 다른 프로세스다. 누른 것을 파일로 남기면 도우미가 집어 올린다.
          try{File.WriteAllText(RecorderButtonFile,"{\"button\":\""+which+"\"}",Encoding.UTF8);}catch{}
          if(which=="stop"||which=="cancel"){if(badge!=null&&!badge.IsDisposed){badge.Close();badge.Dispose();}badge=null;PublishState();}
        };
      }
      badge.Show(time,paused,camera,ScreenForCapture(recordDisplay));
      // 녹화 창이 말없이 사라지면 표시기와 카메라 창이 화면에 그대로 남는다. 12초 동안
      // 소식이 없으면 스스로 거둔다.
      StopBadgeWatch();
      badgeWatch=new System.Windows.Forms.Timer{Interval=12000};
      badgeWatch.Tick+=delegate{
        StopBadgeWatch();
        if(badge!=null&&!badge.IsDisposed){badge.Close();badge.Dispose();}
        badge=null;CloseCamera();recordDisplay="";PublishState();
      };
      badgeWatch.Start();
      // 전체 화면 녹화에서 카메라를 켜면 동그란 카메라 창을 띄운다. 이 창은 녹화에 담긴다.
      // 값이 없는 알림(1초마다 오는 시간 갱신)에는 손대지 않는다. 건드리면 띄운 창이 바로 닫힌다.
      if(cameraView=="1")OpenCamera(cameraName);else if(cameraView!=null)CloseCamera();
      PublishState();
    }
    void StopBadgeWatch(){
      if(badgeWatch==null)return;
      try{badgeWatch.Stop();badgeWatch.Dispose();}catch{}
      badgeWatch=null;
    }
    // 확장이 준 "<크롬이 부르는 이름>|<가로>x<세로>(픽셀)" 로 그 모니터를 찾는다.
    // ① 픽셀 크기가 같은 모니터 ② 이름 안의 번호로 고른 모니터. 둘 다 아니면 null
    // (그때는 마우스가 있는 모니터에 띄운다).
    public static Screen ScreenForCapture(string text){
      if(string.IsNullOrEmpty(text))return null;
      try{
        string[] parts=text.Split('|');
        if(parts.Length>1){
          string[] wh=parts[1].Split('x');
          int w,h;
          if(wh.Length==2&&int.TryParse(wh[0],out w)&&int.TryParse(wh[1],out h)&&w>0){
            List<Screen> fitting=new List<Screen>();
            foreach(Screen one in Screen.AllScreens)
              if(Math.Abs(one.Bounds.Width-w)<=4&&Math.Abs(one.Bounds.Height-h)<=4)fitting.Add(one);
            if(fitting.Count==1)return fitting[0];
            // 똑같은 크기의 모니터가 여럿이면 마우스가 있는 쪽을 고른다.
            if(fitting.Count>1){
              System.Drawing.Point here=Cursor.Position;
              foreach(Screen one in fitting)if(one.Bounds.Contains(here))return one;
              return fitting[0];
            }
          }
        }
        string[] bits=parts[0].Split(':');
        int at;
        if(bits.Length>1&&int.TryParse(bits[1],out at)&&at>=0&&at<Screen.AllScreens.Length)return Screen.AllScreens[at];
      }catch{}
      return null;
    }
    void OpenCamera(string name){
      if(cameraView!=null&&!cameraView.IsDisposed)return;
      // 확장이 '화면 전체를 담는다' 고 알려 줬는데(recordDisplay 가 있음) 그 모니터를 못
      // 가렸으면 띄우지 않는다(엉뚱한 모니터에 뜨면 영상에 카메라가 안 남는다).
      // 탭·창을 담을 때는 recordDisplay 가 비어 있다 — 그때는 어디 떠 있어도 되므로 띄운다.
      Screen onScreen=ScreenForCapture(recordDisplay);
      if(!string.IsNullOrEmpty(recordDisplay)&&Screen.AllScreens.Length>1&&onScreen==null){
        Tell("녹화 중인 모니터를 가리지 못해 카메라를 영상 안에 담습니다");
        return;
      }
      CameraForm view=new CameraForm();
      // 첫 그림은 BeginInvoke 로 UI 실로 건너와야 한다. 그런데 Form 은 Show() 를 하기 전까지
      // 창 손잡이가 없고(IsHandleCreated=false), 그림이 오는 자리가 손잡이가 없으면 건너오기를
      // 통째로 건너뛴다. 그래서 Ready 가 한 번도 불리지 않고 — Ready 가 바로 Show() 를 부르는
      // 자리다 — 2.2초 뒤 giveUp 이 거두었다. 윈도우에서 동그란 카메라 창이 한 번도 뜨지 않은
      // 까닭이다. 손잡이를 먼저 만들어 둔다. 창은 아직 보이지 않는다(Visible 은 Show() 에서 켜진다).
      if(view.Handle==IntPtr.Zero){view.Dispose();return;}
      // 첫 그림이 들어와야 창을 띄우고 '띄웠다' 고 알린다. 확장은 그 표시를 보고 영상에
      // 합칠지 정한다. 늦게 뜨면 둘 다 보이므로, 2.2초 안에 못 열면 아예 포기한다.
      view.Ready=delegate{
        if(cameraView!=view)return;
        view.Place(onScreen);view.Show();PublishState();
      };
      cameraView=view;
      view.Begin(name);
      System.Windows.Forms.Timer giveUp=new System.Windows.Forms.Timer{Interval=2200};
      giveUp.Tick+=delegate{
        giveUp.Stop();giveUp.Dispose();
        if(cameraView==view&&!view.Visible)CloseCamera();
      };
      giveUp.Start();
    }
    // 녹화 전에 한 번 열어 보는 자리. 카메라를 쓸 수 있는지 미리 확인할 수 있다.
    void PreviewCamera(){
      if(cameraView!=null&&!cameraView.IsDisposed){CloseCamera();return;}
      OpenCamera("");
      System.Windows.Forms.Timer shut=new System.Windows.Forms.Timer{Interval=6000};
      shut.Tick+=delegate{shut.Stop();shut.Dispose();CloseCamera();};
      shut.Start();
    }
    void CloseCamera(){
      if(cameraView==null)return;
      CameraForm gone=cameraView;cameraView=null;
      try{if(!gone.IsDisposed){gone.Close();gone.Dispose();}}catch{}
    }
    // 사이드바의 조절값을 지금 떠 있는 창에 반영한다.
    void ApplyKnobs(){
      if(pointer!=null){pointer.Ink=Colour(ringHex);pointer.Span=ringSpan;}
      if(spot!=null)spot.Opacity=focusDim;
      viewDirty=true;
    }
    static Color Colour(string hex){
      string text=(hex??"").Trim();
      if(text.StartsWith("#"))text=text.Substring(1);
      int value;
      if(text.Length!=6||!int.TryParse(text,NumberStyles.HexNumber,CultureInfo.InvariantCulture,out value))return Color.FromArgb(222,243,155);
      return Color.FromArgb((value>>16)&0xff,(value>>8)&0xff,value&0xff);
    }
    // 화면 조각 핀 ------------------------------------------------------------
    public void PlacePins(){float magnify=active?zoom:1;foreach(PinForm pin in pins)pin.Place(magnify,lastOffX,lastOffY);}
    void RaisePins(){foreach(PinForm pin in pins)pin.BringToFront();}
    public void Forget(PinForm pin){pins.Remove(pin);PublishState();}
    public void ClearPins(){
      PinForm[] all=pins.ToArray();pins.Clear();
      foreach(PinForm pin in all){pin.Close();pin.Dispose();}
      PublishState();
    }
    // 통과를 켠 핀은 클릭을 받지 않는다. 그래서 바깥에서 켜고 끄는 길을 둘 다 둔다.
    // 클릭 통과를 켠 핀은 마우스를 받지 않는다(WS_EX_TRANSPARENT). 그래도 그 핀 위에서
    // 휠을 굴리면 투명도가 바뀌어야 한다(사용자 요청). 통과 핀이 있는 동안만 휠을 가로챈다.
    public void SyncWheelHook(){
      bool need=false;
      foreach(PinForm pin in pins)if(pin.Through&&!pin.IsDisposed)need=true;
      if(need&&wheelHook==IntPtr.Zero){
        wheelCallback=WheelHook;
        wheelHook=Native.SetWindowsHookEx(14,wheelCallback,Native.GetModuleHandle(null),0);
      }else if(!need&&wheelHook!=IntPtr.Zero){
        try{Native.UnhookWindowsHookEx(wheelHook);}catch{}
        wheelHook=IntPtr.Zero;wheelCallback=null;
      }
    }
    IntPtr WheelHook(int code,IntPtr message,IntPtr data){
      if(code>=0&&message.ToInt32()==0x020A&&snipper==null){
        Native.Mouse mouse=(Native.Mouse)Marshal.PtrToStructure(data,typeof(Native.Mouse));
        short delta=(short)(mouse.mouseData>>16);
        System.Drawing.Point where=new System.Drawing.Point(mouse.pt.X,mouse.pt.Y);
        // 나중에 띄운 핀이 위에 있다. 뒤에서부터 본다.
        for(int at=pins.Count-1;at>=0;at--){
          PinForm pin=pins[at];
          if(pin.IsDisposed||!pin.Through||!pin.Visible)continue;
          if(!pin.Bounds.Contains(where))continue;
          PinForm target=pin;double by=delta>0?.06:-.06;
          try{ pin.BeginInvoke(new Action(delegate{ target.NudgeShade(by); })); }catch{}
          return new IntPtr(1);    // 아래 앱으로 내려보내지 않는다(같이 스크롤되면 안 된다)
        }
      }
      return Native.CallNextHookEx(wheelHook,code,message,data);
    }
    public void UnlockPins(){foreach(PinForm pin in pins)if(pin.Through)pin.SetThrough(false);PublishState();}
    public void ThroughPins(){
      if(pins.Count==0)return;
      bool wanted=true;
      foreach(PinForm pin in pins)if(pin.Through)wanted=false;
      foreach(PinForm pin in pins)pin.SetThrough(wanted);
      PublishState();
    }
    public void AddPin(Bitmap image,Point centre){
      if(image==null)return;
      if(pins.Count>=MaxPins){image.Dispose();MessageBox.Show("핀은 "+MaxPins+"개까지 띄울 수 있습니다. 쓰지 않는 핀을 닫아 주세요.");return;}
      PinForm pin=new PinForm(image,this,centre);
      pins.Add(pin);pin.Show();pin.Place(active?zoom:1,lastOffX,lastOffY);pin.BringToFront();viewDirty=true;PublishState();
    }
    void PinClipboard(){
      try{
        if(Clipboard.ContainsImage()){using(Image image=Clipboard.GetImage())if(image!=null){AddPin(new Bitmap(image),Control.MousePosition);return;}}
        if(Clipboard.ContainsText()){string text=Clipboard.GetText();if(!string.IsNullOrWhiteSpace(text)){AddPin(Card(text),Control.MousePosition);return;}}
      }catch{}
      MessageBox.Show("클립보드에 붙일 그림이나 글이 없습니다. 먼저 복사해 주세요.");
    }
    // 글도 붙일 수 있어야 한다. 창 하나로 다루려고 글을 카드 그림으로 그려 둔다.
    static Bitmap Card(string text){
      string body=text.Length>1200?text.Substring(0,1200):text;
      using(Font face=new Font("Malgun Gothic",11)){
        SizeF size;
        using(Bitmap probe=new Bitmap(1,1))using(Graphics probeG=Graphics.FromImage(probe))size=probeG.MeasureString(body,face,520);
        int w=Math.Min(560,Math.Max(180,(int)Math.Ceiling(size.Width)+32));
        int h=Math.Min(1440,Math.Max(64,(int)Math.Ceiling(size.Height)+28));
        Bitmap made=new Bitmap(w,h);
        using(Graphics g=Graphics.FromImage(made)){
          g.Clear(Color.FromArgb(255,252,235));
          using(SolidBrush ink=new SolidBrush(Color.Black))g.DrawString(body,face,ink,new RectangleF(16,14,w-32,h-28));
        }
        return made;
      }
    }
    // 캡처와 핀은 바탕화면을 어지르지 않도록 바탕화면 아래 ‘캡처이미지’ 폴더에 모은다.
    // 폴더는 처음 저장할 때 만든다. 만들지 못하면 예전처럼 바탕화면에 남긴다.
    public const string ShotsName="캡처이미지";
    public static string DesktopPath {get{return Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);}}
    public static string ShotsPath {
      get{
        string desk=DesktopPath;
        try{
          string target=Path.Combine(desk,ShotsName);
          if(File.Exists(target))return desk;
          if(!Directory.Exists(target))Directory.CreateDirectory(target);
          return target;
        }catch{return desk;}
      }
    }
    // 바탕화면 감시기가 다시 가져가지 않도록 캡처와 다른 이름을 쓴다.
    public static string SavePin(Image image){
      try{
        string folder=ShotsPath;
        string stamp=DateTime.Now.ToString("yyyyMMdd-HHmmss");
        string name="다있쌤-핀-"+stamp+".png";
        string file=Path.Combine(folder,name);
        int counter=1;
        while(File.Exists(file)){counter++;name="다있쌤-핀-"+stamp+"-"+counter+".png";file=Path.Combine(folder,name);}
        image.Save(file,System.Drawing.Imaging.ImageFormat.Png);
        return name;
      }catch{return null;}
    }
    void BeginSnip(){BeginSnip(false);}
    // save 면 고른 조각을 핀으로 띄우지 않고 ‘캡처이미지’ 폴더에 저장하고 복사한다(도크의 선택 영역 캡처).
    void BeginSnip(bool save){
      if(snipper!=null)return;
      snipSave=save;
      // 모니터를 전부 덮는다. 다른 모니터 위의 앱도 고를 수 있어야 한다(사용자 보고).
      Rectangle area=SystemInformation.VirtualScreen;
      // 확대 중이면 보이는 자리와 실제 화면이 어긋난다. 조각 내는 동안만 원래 크기로 돌린다.
      snipZoom=zoom;snipFocus=focus;
      if(active){zoom=1;SetFocusMode(false);UpdateView();}
      // Windows 는 화면을 그대로 복사하므로 macOS 의 sharingType 처럼 특정 창만 뺄 수 없다.
      // 발표 표시와 기존 핀을 잠시 감춰 조각 그림에 끼어들지 않게 한다.
      if(pointer!=null)pointer.Hide();
      if(spot!=null)spot.Hide();
      foreach(PinForm pin in pins)pin.Hide();
      Application.DoEvents();Thread.Sleep(140);
      Bitmap shot=null;
      try{
        shot=new Bitmap(area.Width,area.Height);
        using(Graphics g=Graphics.FromImage(shot))g.CopyFromScreen(area.Left,area.Top,0,0,area.Size);
      }catch{
        if(shot!=null)shot.Dispose();
        shot=null;
      }
      foreach(PinForm pin in pins)pin.Show();
      if(shot==null){RestoreAfterSnip();MessageBox.Show("화면을 읽지 못했습니다.");return;}
      Bitmap held=shot;
      snipper=new SnipForm(held,area);
      snipper.Done=delegate(Rectangle box){FinishSnip(box,held,area);};
      snipper.Cancelled=delegate{EndSnip();};
      snipper.Show();snipper.Activate();
    }
    void FinishSnip(Rectangle box,Bitmap shot,Rectangle area){
      bool saving=snipSave;
      Bitmap cut=null;
      try{cut=shot.Clone(box,shot.PixelFormat);}catch{cut=null;}
      EndSnip();
      if(cut==null){MessageBox.Show("조각을 잘라내지 못했습니다. 조금 더 넓게 끌어 주세요.");return;}
      if(saving){SaveShot(cut);return;}
      AddPin(cut,new Point(area.Left+box.Left+box.Width/2,area.Top+box.Top+box.Height/2));
    }
    // 고른 조각을 폴더에 저장하고 클립보드에도 올린다. 둘 중 하나만 돼도 그렇게 알린다.
    void SaveShot(Bitmap image){
      bool copied=false;
      try{Clipboard.SetImage(image);copied=true;}catch{}
      string name=Presenter.SavePin(image);
      try{image.Dispose();}catch{}
      if(name!=null&&copied)Tell("‘"+ShotsName+"’ 폴더에 저장하고 클립보드에 복사했습니다");
      else if(name!=null)Tell("‘"+ShotsName+"’ 폴더에 저장했습니다");
      else if(copied)Tell("클립보드에 복사했습니다 · 폴더에 저장하지 못했습니다");
      else Tell("저장도 복사도 하지 못했습니다");
    }
    void Tell(string text){
      try{
        if(tray==null)return;
        tray.BalloonTipTitle="다있쌤 발표 도우미";tray.BalloonTipText=text;tray.ShowBalloonTip(2500);
      }catch{}
    }
    void EndSnip(){
      snipSave=false;
      if(snipper!=null){SnipForm gone=snipper;snipper=null;gone.Close();gone.Dispose();}
      RestoreAfterSnip();
    }
    void RestoreAfterSnip(){
      foreach(PinForm pin in pins)pin.Show();
      if(!active)return;
      zoom=snipZoom;if(snipFocus)SetFocusMode(true);
      if(pointer!=null)pointer.Show();
      Redraw();
    }
    void Cleanup(){
      // 전역 단축키를 먼저 돌려준다. 남겨 두면 다음에 켤 때 등록이 실패한다.
      if(help!=null&&!help.IsDisposed&&help.IsHandleCreated){
        for(int i=0;i<Keys2.Order.Length;i++)Native.UnregisterHotKey(help.Handle,i+1);
      }
      if(badge!=null&&!badge.IsDisposed){try{badge.Close();badge.Dispose();}catch{}}badge=null;
      EndSnip();ClearPins();StopBadgeWatch();CloseCamera();if(wheelHook!=IntPtr.Zero){try{Native.UnhookWindowsHookEx(wheelHook);}catch{}wheelHook=IntPtr.Zero;}Stop();if(recorderWait!=null){recorderWait.Unregister(null);recorderWait=null;}if(commandWait!=null){commandWait.Unregister(null);commandWait=null;}try{File.Delete(StateFile);}catch{}if(activationWait!=null){activationWait.Unregister(null);activationWait=null;}SystemEvents.SessionEnding-=SessionEnding;SystemEvents.DisplaySettingsChanged-=DisplayChanged;SystemEvents.PowerModeChanged-=PowerChanged;SystemEvents.SessionSwitch-=SessionSwitch;if(tray!=null){tray.Visible=false;tray.Dispose();tray=null;}}
    protected override void ExitThreadCore(){exiting=true;Cleanup();if(help!=null)help.Dispose();base.ExitThreadCore();}
  }

  // Chrome launches this same executable with the caller origin as an argument. In that mode there is no
  // tray app: the process watches the clipboard for as long as the extension keeps the port open.
  static class NativeHost {
    public const string HostName="app.browsersheriff.presenter";
    public const string ExtensionID="ehgodopakibamgeopmelemjmjdjhbdgm";
    const string Prefix="다있쌤-캡처-";
    const string OldPrefix="보완관-캡처-";        // 이름을 바꾸기 전 파일
    static Stream output;
    static readonly object writeLock=new object();
    static bool collecting=false;
    static uint lastSequence;
    static string lastText="";
    static string Desktop {get{return Presenter.DesktopPath;}}
    static string Shots {get{return Presenter.ShotsPath;}}

    static void Send(object value){
      byte[] body=JsonSerializer.SerializeToUtf8Bytes(value);
      byte[] header=BitConverter.GetBytes(body.Length);
      lock(writeLock){output.Write(header,0,4);output.Write(body,0,body.Length);output.Flush();}
    }
    static string Thumb(Image image){
      double factor=Math.Min(1.0,240.0/Math.Max(image.Width,image.Height));
      int w=Math.Max(1,(int)(image.Width*factor)),h=Math.Max(1,(int)(image.Height*factor));
      using(Bitmap small=new Bitmap(w,h))using(Graphics g=Graphics.FromImage(small))using(MemoryStream stream=new MemoryStream()){
        g.InterpolationMode=InterpolationMode.HighQualityBicubic;g.DrawImage(image,0,0,w,h);
        small.Save(stream,System.Drawing.Imaging.ImageFormat.Png);
        return Convert.ToBase64String(stream.ToArray());
      }
    }
    static void SendImage(Image image){
      string folder=Shots;
      string name=Prefix+DateTime.Now.ToString("yyyyMMdd-HHmmss")+".png";
      string file=Path.Combine(folder,name);
      int counter=1;
      while(File.Exists(file)){counter++;name=Prefix+DateTime.Now.ToString("yyyyMMdd-HHmmss")+"-"+counter+".png";file=Path.Combine(folder,name);}
      try{image.Save(file,System.Drawing.Imaging.ImageFormat.Png);}
      catch{Send(new{kind="error",message="바탕화면의 ‘캡처이미지’ 폴더에 저장하지 못했습니다."});return;}
      Send(new{kind="image",file=file,name=name,width=image.Width,height=image.Height,thumb=Thumb(image)});
    }
    static void Poll(){
      uint sequence=Native.GetClipboardSequenceNumber();
      if(sequence==lastSequence)return;
      lastSequence=sequence;
      if(!collecting)return;
      try{
        if(Clipboard.ContainsImage()){using(Image image=Clipboard.GetImage()){if(image!=null)SendImage(image);}return;}
        if(Clipboard.ContainsText()){
          string text=Clipboard.GetText();
          if(!string.IsNullOrEmpty(text)&&text!=lastText){lastText=text;Send(new{kind="text",text=text.Length>2000?text.Substring(0,2000):text});}
        }
      }catch{}
    }
    // Only our own captures may be read back, so a stray request cannot open other files.
    // 예전 메모는 바탕화면 경로를 들고 있으므로 두 폴더를 모두 허용한다.
    static bool Allowed(string file){
      try{
        string full=Path.GetFullPath(file);
        string leaf=Path.GetFileName(full);
        if(!leaf.StartsWith(Prefix,StringComparison.Ordinal)&&!leaf.StartsWith(OldPrefix,StringComparison.Ordinal))return false;
        if(!full.EndsWith(".png",StringComparison.OrdinalIgnoreCase)||!File.Exists(full))return false;
        string home=Path.GetDirectoryName(full)+Path.DirectorySeparatorChar;
        foreach(string folder in new[]{Desktop,Shots}){
          if(string.Equals(home,Path.GetFullPath(folder)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))return true;
        }
        return false;
      }catch{return false;}
    }
    // 확장의 캡처 도구가 만든 그림을 바탕화면 ‘캡처이미지’ 폴더에 저장하고 클립보드에 올린다.
    // 이름은 ‘다있쌤-스크린샷-’ — ‘다있쌤-캡처-’ 는 메모 자동 가져오기가 읽는 이름이라 피한다.
    static byte[] Picture(JsonElement root){
      JsonElement node;
      if(!root.TryGetProperty("image",out node)||node.ValueKind!=JsonValueKind.String)return null;
      try{return Convert.FromBase64String(node.GetString());}catch{return null;}
    }
    static bool Flag(JsonElement root,string key){JsonElement node;return !root.TryGetProperty(key,out node)||node.ValueKind!=JsonValueKind.False;}
    static void Shot(JsonElement root){
      byte[] bytes=Picture(root);
      if(bytes==null){Send(new{kind="shot",ok=false,message="그림을 읽지 못했습니다."});return;}
      JsonElement node;
      bool jpg=root.TryGetProperty("ext",out node)&&node.ValueKind==JsonValueKind.String&&node.GetString()=="jpg";
      string saved="";
      if(Flag(root,"save")){
        string folder=Shots,ext=jpg?".jpg":".png";
        string name="다있쌤-스크린샷-"+DateTime.Now.ToString("yyyy-MM-dd HH.mm.ss",CultureInfo.InvariantCulture);
        string target=Path.Combine(folder,name+ext);
        for(int n=2;File.Exists(target);n++)target=Path.Combine(folder,name+" ("+n+")"+ext);
        try{File.WriteAllBytes(target,bytes);saved=target;}
        catch{Send(new{kind="shot",ok=false,message="바탕화면의 ‘캡처이미지’ 폴더에 저장하지 못했습니다."});return;}
      }
      bool copied=false;
      if(Flag(root,"copy")){
        try{
          using(MemoryStream memory=new MemoryStream(bytes))
          using(Image image=Image.FromStream(memory)){
            // 그림 그대로(PNG)와 비트맵을 함께 올린다. 투명한 곳을 아는 프로그램은 PNG 를 쓴다.
            DataObject data=new DataObject();
            data.SetImage(image);
            data.SetData("PNG",false,new MemoryStream(bytes));
            Clipboard.SetDataObject(data,true);
          }
          lastSequence=Native.GetClipboardSequenceNumber();copied=true;
        }catch{}
      }
      Send(new{kind="shot",ok=true,path=saved,copied=copied});
    }
    // 그림 속 글자를 Windows 에 들어 있는 글자 인식(Windows.Media.Ocr)으로 읽는다. 기기 밖으로 보내지 않는다.
    static void Ocr(JsonElement root){
      byte[] bytes=Picture(root);
      if(bytes==null){Send(new{kind="ocr",ok=false,message="그림을 읽지 못했습니다."});return;}
      try{
        Windows.Media.Ocr.OcrEngine engine=Windows.Media.Ocr.OcrEngine.TryCreateFromLanguage(new Windows.Globalization.Language("ko"))
          ??Windows.Media.Ocr.OcrEngine.TryCreateFromUserProfileLanguages();
        if(engine==null){Send(new{kind="ocr",ok=false,message="Windows 에 한국어 글자 인식이 설치되어 있지 않습니다. 설정 → 시간 및 언어 → 언어 및 지역 → 한국어 → 언어 옵션에서 ‘광학 문자 인식’ 을 설치해 주세요."});return;}
        using(Windows.Storage.Streams.InMemoryRandomAccessStream stream=new Windows.Storage.Streams.InMemoryRandomAccessStream()){
          using(Windows.Storage.Streams.DataWriter writer=new Windows.Storage.Streams.DataWriter(stream)){
            writer.WriteBytes(bytes);writer.StoreAsync().AsTask().Wait();writer.DetachStream();
          }
          stream.Seek(0);
          Windows.Graphics.Imaging.BitmapDecoder decoder=Windows.Graphics.Imaging.BitmapDecoder.CreateAsync(stream).AsTask().Result;
          // 글자 인식에는 한 변의 한도가 있다(보통 10000px). 넘으면 비율대로 줄인다.
          uint limit=Windows.Media.Ocr.OcrEngine.MaxImageDimension;
          double scale=Math.Min(1.0,(double)limit/Math.Max(decoder.PixelWidth,decoder.PixelHeight));
          Windows.Graphics.Imaging.BitmapTransform transform=new Windows.Graphics.Imaging.BitmapTransform{
            ScaledWidth=(uint)Math.Max(1,Math.Floor(decoder.PixelWidth*scale)),ScaledHeight=(uint)Math.Max(1,Math.Floor(decoder.PixelHeight*scale))};
          using(Windows.Graphics.Imaging.SoftwareBitmap bitmap=decoder.GetSoftwareBitmapAsync(
              Windows.Graphics.Imaging.BitmapPixelFormat.Bgra8,Windows.Graphics.Imaging.BitmapAlphaMode.Premultiplied,transform,
              Windows.Graphics.Imaging.ExifOrientationMode.IgnoreExifOrientation,Windows.Graphics.Imaging.ColorManagementMode.DoNotColorManage).AsTask().Result){
            Windows.Media.Ocr.OcrResult result=engine.RecognizeAsync(bitmap).AsTask().Result;
            List<string> lines=new List<string>();
            foreach(Windows.Media.Ocr.OcrLine line in result.Lines)lines.Add(line.Text);
            Send(new{kind="ocr",ok=true,text=string.Join("\n",lines)});
          }
        }
      }catch{Send(new{kind="ocr",ok=false,message="글자를 읽지 못했습니다."});}
    }
    // 녹화 표시기(화면 녹화에 담기지 않는 작은 창)를 앱에 띄우라고 알린다.
    static bool watchingRecorder=false;
    static void Recorder(JsonElement root){
      var payload=new Dictionary<string,string>();
      foreach(string key in new[]{"action","time","paused","camera","cameraView","cameraName","display"}){
        JsonElement node;
        if(root.TryGetProperty(key,out node)&&node.ValueKind==JsonValueKind.String)payload[key]=node.GetString();
      }
      // 앱이 꺼져 있으면 표시기를 그릴 곳이 없다. 조용히 한 번 띄운다(끄는 명령이면 그냥 둔다).
      string action;payload.TryGetValue("action",out action);
      if(!Alive()){
        if(action=="hide"){Send(new{kind="recorder",ok=true});return;}
        try{
          System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo{
            FileName=System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName,Arguments="--quiet",UseShellExecute=false});
        }catch{}
        for(int waited=0;waited<60&&!Alive();waited++)Thread.Sleep(100);
      }
      try{File.WriteAllText(Presenter.RecorderFile,JsonSerializer.Serialize(payload),Encoding.UTF8);}
      catch{Send(new{kind="recorder",ok=false});return;}
      try{using(EventWaitHandle door=EventWaitHandle.OpenExisting(Presenter.RecorderEvent))door.Set();}catch{}
      Send(new{kind="recorder",ok=true});
    }
    // 표시기의 단추를 누르면 앱이 파일로 남긴다. 그것을 집어 확장에 올린다.
    static void PollRecorder(){
      if(!watchingRecorder)return;
      string raw;
      try{ if(!File.Exists(Presenter.RecorderButtonFile))return; raw=File.ReadAllText(Presenter.RecorderButtonFile,Encoding.UTF8); }
      catch{return;}
      try{File.Delete(Presenter.RecorderButtonFile);}catch{}
      try{
        using(JsonDocument document=JsonDocument.Parse(raw)){
          JsonElement node;
          if(document.RootElement.TryGetProperty("button",out node))Send(new{kind="recorder",button=node.GetString()});
        }
      }catch{}
    }
    static void CopyFile(string file){
      if(!Allowed(file)){Send(new{kind="error",message="바탕화면과 ‘캡처이미지’ 폴더의 캡처 파일만 클립보드에 올릴 수 있습니다."});return;}
      try{
        using(Image image=Image.FromFile(file))Clipboard.SetImage(image);
        lastSequence=Native.GetClipboardSequenceNumber();
        Send(new{kind="copied",file=file});
      }catch{Send(new{kind="error",message="이미지를 클립보드에 올리지 못했습니다."});}
    }
    // 앱이 떠 있으면 그 앱이 이름 있는 이벤트를 만들어 두었다. 열리면 살아 있는 것이다.
    static bool Alive(){
      try{using(EventWaitHandle.OpenExisting(Presenter.CommandEvent))return true;}
      catch{return false;}
    }
    sealed class Shown {public bool Presenting,Focus,Running,Camera;public int Pins,Through;public string Keys;}
    static int Count(JsonElement root,string key){
      JsonElement node;int value;
      if(!root.TryGetProperty(key,out node)||!node.TryGetInt32(out value))return 0;
      return value;
    }
    // 앱이 상태 파일을 다시 썼는지 보는 표. 파일이 없으면 DateTime.MinValue 가 돌아온다.
    static DateTime StateStamp(){
      try{return File.GetLastWriteTimeUtc(Presenter.StateFile);}catch{return DateTime.MinValue;}
    }
    static Shown ReadState(){
      Shown now=new Shown();
      if(!Alive())return now;
      try{
        using(JsonDocument document=JsonDocument.Parse(File.ReadAllText(Presenter.StateFile,Encoding.UTF8))){
          JsonElement root=document.RootElement,node;
          now.Presenting=root.TryGetProperty("presenting",out node)&&node.ValueKind==JsonValueKind.True;
          now.Focus=root.TryGetProperty("focus",out node)&&node.ValueKind==JsonValueKind.True;
          now.Pins=Count(root,"pins");now.Through=Count(root,"through");
          now.Camera=root.TryGetProperty("camera",out node)&&node.ValueKind==JsonValueKind.True;
          now.Running=true;
          if(root.TryGetProperty("keys",out node)&&node.ValueKind==JsonValueKind.String)now.Keys=node.GetString();
        }
      }catch{return new Shown();}
      return now;
    }
    static void Reply(bool launched){
      Shown now=ReadState();
      // running: 앱이 떠 있는지. keys: 앱이 지금 듣고 있는 조합(옛 앱이면 빠진다).
      bool running=now.Running||Alive();
      if(now.Keys!=null)
        Send(new{kind="presenter",ok=true,launched=launched,running=running,keys=now.Keys,
          presenting=now.Presenting,focus=now.Focus,pins=now.Pins,through=now.Through,camera=now.Camera});
      else
        Send(new{kind="presenter",ok=true,launched=launched,running=running,
          presenting=now.Presenting,focus=now.Focus,pins=now.Pins,through=now.Through,camera=now.Camera});
    }
    // 사이드바 도크의 명령을 트레이 앱으로 넘긴다. Chrome 이 띄운 이 프로세스와 앱은 별개다.
    static void Forward(JsonElement root){
      Dictionary<string,string> payload=new Dictionary<string,string>();
      // 여기 적힌 이름만 앱까지 간다. 'keys' 를 빠뜨려 사용자가 바꾼 단축키가 윈도우에서는
      // 한 번도 앱에 닿지 않았다. 확장 background.js 에도 같은 목록이 있다 — 둘 다 고칠 것.
      foreach(string key in new[]{"action","ring","ringSize","dim","blur","keys"}){
        JsonElement node;
        if(root.TryGetProperty(key,out node)&&node.ValueKind==JsonValueKind.String)payload[key]=node.GetString();
      }
      string action;payload.TryGetValue("action",out action);
      // 상태만 묻는 호출은 아무 것도 바꾸지 않는다.
      if(action=="state"){Reply(false);return;}
      // 명령을 먼저 적어 둔다. 가상 머신에서는 앱이 뜨는 데 10초가 넘게 걸리기도 하는데,
      // 그때 명령을 버리면 도크가 죽은 것처럼 보인다. 앱은 시작하면서 갓 적힌 명령을 집어 간다.
      payload["at"]=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds().ToString(CultureInfo.InvariantCulture);
      try{File.WriteAllText(Presenter.CommandFile,JsonSerializer.Serialize(payload),Encoding.UTF8);}
      catch{Send(new{kind="presenter",ok=false,message="명령을 전달하지 못했습니다."});return;}
      bool launched=false;
      if(!Alive()){
        try{
          // 이 프로세스와 트레이 앱은 같은 실행 파일이다. 스스로를 조용히 한 번 더 띄운다.
          System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo{
            FileName=System.Diagnostics.Process.GetCurrentProcess().MainModule.FileName,
            Arguments="--quiet",UseShellExecute=false});
        }catch{Send(new{kind="presenter",ok=false,message="발표 도우미 앱을 켜지 못했습니다."});return;}
        launched=true;
        // 트레이 앱이 창과 이벤트를 만들 때까지 기다린다.
        for(int waited=0;waited<100&&!Alive();waited++)Thread.Sleep(100);
        if(!Alive()){Send(new{kind="presenter",ok=false,message="발표 도우미 앱이 뜨지 않았습니다. 설치된 앱이 옛 버전이면 명령 통로가 없습니다. Check.cmd 를 실행해 확인하고, 트레이에서 ‘앱 종료’ 후 Install.cmd 를 다시 실행해 주세요."});return;}
        // 앱이 시작하며 이미 집어 갔다면 더 보낼 것이 없다.
        Thread.Sleep(400);
        if(!File.Exists(Presenter.CommandFile)){Reply(true);return;}
      }
      DateTime before=StateStamp();
      try{using(EventWaitHandle door=EventWaitHandle.OpenExisting(Presenter.CommandEvent))door.Set();}
      catch{Send(new{kind="presenter",ok=false,message="발표 도우미 앱에 연결하지 못했습니다."});return;}
      // 앱이 상태 파일을 고쳐 쓸 틈을 준 뒤 답한다. 예전에는 무조건 400ms 를 잤다. 사이드바의
      // 조절값(어둡기·흐림·고리 색·고리 크기)은 끌 때마다 input 마다 한 번씩 오고, 그 한 번마다
      // 이 프로세스가 새로 뜨므로 그 400ms 가 그대로 손에 느껴지는 지연이 되었다. 이제 앱이
      // 상태를 다시 쓰는 즉시 답하고 400ms 는 한도로만 쓴다(못 쓰면 예전과 같이 400ms 기다린다).
      for(int waited=0;waited<20&&StateStamp()==before;waited++)Thread.Sleep(20);
      Reply(launched);
    }
    static void Handle(string raw){
      try{
        using(JsonDocument document=JsonDocument.Parse(raw)){
          JsonElement root=document.RootElement;JsonElement typeNode;
          if(!root.TryGetProperty("type",out typeNode))return;
          string type=typeNode.GetString();
          // ready 를 띄우자마자 보내면 안 된다. sendNativeMessage 는 "첫 번째" 답만 받고
          // 포트를 닫으므로, 발표 상태 대신 ready 가 확장에 전달되어 사이드바가 늘 빈손이었다.
          // 오래 열어 두는 포트(클립보드 도우미)만 start 를 보내므로 그때만 알린다.
          if(type=="start"){collecting=true;lastSequence=Native.GetClipboardSequenceNumber();Send(new{kind="ready",platform="windows",desktop=Shots});Send(new{kind="state",collecting=true});}
          else if(type=="stop"){collecting=false;Send(new{kind="state",collecting=false});}
          else if(type=="copy-file"){JsonElement fileNode;if(root.TryGetProperty("file",out fileNode))CopyFile(fileNode.GetString());}
          else if(type=="presenter")Forward(root);
          else if(type=="shot")Shot(root);
          else if(type=="ocr")Ocr(root);
          else if(type=="recorder")Recorder(root);
          else if(type=="recorder-watch"){watchingRecorder=true;Send(new{kind="recorder",watching=true});}
          else if(type=="screen-settings")Send(new{kind="screen-settings",ok=true,message="윈도우에서는 따로 권한을 주지 않아도 됩니다."});
          // 모르는 명령에도 반드시 답한다. 답하지 않으면 확장이 끝없이 기다린다.
          else Send(new{kind="unknown",ok=false,message="이 도우미가 모르는 명령입니다. 새 버전을 설치해 주세요."});
        }
      }catch{}
    }
    static string ReadMessage(Stream input){
      byte[] header=new byte[4];int read=0;
      while(read<4){int step=input.Read(header,read,4-read);if(step<=0)return null;read+=step;}
      int length=BitConverter.ToInt32(header,0);
      // 캡처 그림(전체 페이지는 수십 MB)을 받으므로 넉넉히 둔다. Chrome 이 보내는 쪽 한도는 4GB.
      if(length<=0||length>96*1048576)return null;
      byte[] body=new byte[length];read=0;
      while(read<length){int step=input.Read(body,read,length-read);if(step<=0)return null;read+=step;}
      return Encoding.UTF8.GetString(body);
    }
    public static void Run(string[] args){
      bool trusted=false;
      foreach(string argument in args)if(argument.StartsWith("chrome-extension://"+ExtensionID,StringComparison.Ordinal))trusted=true;
      if(!trusted)return;
      output=Console.OpenStandardOutput();
      Stream input=Console.OpenStandardInput();
      lastSequence=Native.GetClipboardSequenceNumber();
      ConcurrentQueue<string> inbox=new ConcurrentQueue<string>();
      bool closed=false;
      Thread reader=new Thread(delegate(){
        try{while(true){string message=ReadMessage(input);if(message==null)break;inbox.Enqueue(message);}}catch{}
        closed=true;
      });
      reader.IsBackground=true;reader.Start();
      // chrome.runtime.sendNativeMessage 는 메시지를 쓰자마자 stdin 을 닫는다. 예전에는
      // while(!closed) 가 그 순간 바로 빠져나가, 방금 큐에 들어온 명령을 한 번도 처리하지
      // 않고 프로세스가 끝났다. 300ms 를 자고 깨면 늘 닫힌 뒤였으므로 사이드바의 발표·핀
      // 명령은 Windows 에서 100% 버려지고 있었다. 반드시 큐를 비우고 나서 끝낸다.
      DateTime leaveAt=DateTime.MaxValue;
      while(true){
        string raw;
        while(inbox.TryDequeue(out raw))Handle(raw);
        if(closed){
          // 큐를 비운 뒤 잠깐만 더 머문다. 예전에는 1초였는데, 사이드바 조절값처럼 잇달아
          // 오는 명령에서는 그 1초 동안 프로세스가 겹겹이 쌓인다(실측: 0.7초 동안 12번
          // 보내면 도우미 13개가 동시에 떠 합쳐 465MB). closed 는 읽기 실이 다 넣고 나서
          // 켜지므로 큐가 빈 것만 확인하면 놓치는 명령은 없다 — 1초는 여유였을 뿐이다.
          if(leaveAt==DateTime.MaxValue)leaveAt=DateTime.UtcNow.AddMilliseconds(250);
          if(inbox.IsEmpty&&DateTime.UtcNow>=leaveAt)break;
        }
        if(collecting)Poll();
        PollRecorder();
        Thread.Sleep(closed?50:300);
      }
    }
  }
  public static class Program {
    static void Line(System.Text.StringBuilder report,string label,bool ok,string detail){
      report.AppendLine((ok?"[ 정상 ] ":"[ 문제 ] ")+label+(detail.Length>0?"\r\n           "+detail:""));
    }
    // 실행 중인 발표 도우미를 먼저 내리고 실행 파일을 덮어쓴다.
    static bool Replace(string target){
      for(int round=0;round<3;round++){
        try{File.Copy(Application.ExecutablePath,target,true);return true;}
        catch(IOException){}
        catch(UnauthorizedAccessException){}
        if(round==0){
          if(MessageBox.Show("발표 도우미가 실행 중이라 새 버전으로 바꿀 수 없습니다.\r\n지금 종료하고 업데이트할까요?",
                "다있쌤 설치",MessageBoxButtons.YesNo,MessageBoxIcon.Question)!=DialogResult.Yes){
            MessageBox.Show("업데이트를 멈췄습니다. 트레이 아이콘에서 ‘앱 종료’ 를 누른 뒤 Install.cmd 를 다시 실행하세요.");
            return false;
          }
          StopRunning(target);
        }
        Thread.Sleep(900);
      }
      MessageBox.Show("실행 파일을 바꾸지 못했습니다.\r\n트레이 아이콘에서 ‘앱 종료’ 를 누르고 Install.cmd 를 다시 실행해 주세요.\r\n\r\n"+target);
      return false;
    }
    static void StopRunning(string target){
      int mine=System.Diagnostics.Process.GetCurrentProcess().Id;
      foreach(System.Diagnostics.Process other in System.Diagnostics.Process.GetProcessesByName("Presenter")){
        try{
          if(other.Id==mine)continue;
          string path=null;try{path=other.MainModule.FileName;}catch{}
          // 우리가 설치한 그 파일만 내린다. 이름이 같은 남의 프로그램은 건드리지 않는다.
          if(path==null||!String.Equals(path,target,StringComparison.OrdinalIgnoreCase))continue;
          if(!other.CloseMainWindow()||!other.WaitForExit(2500))other.Kill();
          other.WaitForExit(2500);
        }catch{}
        finally{try{other.Dispose();}catch{}}
      }
    }
    static void SelfCheck(){
      System.Text.StringBuilder r=new System.Text.StringBuilder();
      r.AppendLine("다있쌤 · 발표 도우미 점검");
      r.AppendLine("버전 "+Presenter.Ver+"   "+DateTime.Now.ToString("yyyy-MM-dd HH:mm"));
      r.AppendLine(new string('-',58));

      string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BrowserSheriff");
      string target=Path.Combine(dir,"Presenter.exe");
      bool copied=File.Exists(target);
      Line(r,"앱 파일 설치",copied,copied?target:"Install.cmd 를 먼저 실행하세요.");
      if(copied){
        var info=System.Diagnostics.FileVersionInfo.GetVersionInfo(target);
        // 예전에는 양쪽 ProductVersion 의 '+' 앞만 견줬다. 그 값은 InformationalVersion
        // 이라 0.31.0 에 멈춰 있었고, 0.31.0 짜리 옛 앱이 깔려 있어도 늘 '정상' 이 나왔다.
        // 버전이 올라갔는지(FileVersion)와 같은 빌드인지(+커밋)를 함께 본다.
        bool same=Presenter.BuildOf(info)==Presenter.Build;
        Line(r,"설치된 앱이 최신인지",same,"설치본 "+Presenter.VerOf(info)+" / 지금 실행 "+Presenter.Ver
          +(same?"":"\r\n           → 설치본과 지금 실행 중인 파일이 다른 빌드입니다. Install.cmd 를 다시 실행하세요."));
      }

      string manifestPath=Path.Combine(dir,"native-host.json");
      bool hasManifest=File.Exists(manifestPath);
      Line(r,"도우미 설명 파일",hasManifest,hasManifest?manifestPath:"Install.cmd 를 실행하세요.");

      string registered=null;
      try{using(RegistryKey key=Registry.CurrentUser.OpenSubKey(@"Software\Google\Chrome\NativeMessagingHosts\"+NativeHost.HostName))
        if(key!=null)registered=Convert.ToString(key.GetValue(""));}catch{}
      bool regOk=!string.IsNullOrEmpty(registered)&&File.Exists(registered);
      Line(r,"Chrome 등록",regOk,regOk?registered:"레지스트리에 없습니다. Install.cmd 를 실행하고 Chrome 을 다시 켜세요.");

      if(hasManifest){
        string text="";try{text=File.ReadAllText(manifestPath);}catch{}
        bool idOk=text.Contains(NativeHost.ExtensionID);
        Line(r,"확장 번호 일치",idOk,idOk?NativeHost.ExtensionID:"확장 번호가 다릅니다. Install.cmd 를 다시 실행하세요.");
      }

      bool alive=false;
      try{using(EventWaitHandle.OpenExisting(Presenter.CommandEvent))alive=true;}catch{}
      Line(r,"발표 도우미 앱 실행 중",alive,alive?"명령 통로 열림":"꺼져 있습니다. 사이드바 버튼이 자동으로 켜거나, 직접 Presenter.exe 를 실행하세요.");
      if(alive&&File.Exists(Presenter.StateFile)){
        string state="";try{state=File.ReadAllText(Presenter.StateFile);}catch{}
        string running=null;
        try{using(JsonDocument d=JsonDocument.Parse(state)){JsonElement n;if(d.RootElement.TryGetProperty("version",out n))running=n.GetString();}}catch{}
        bool fresh=running!=null&&running==Presenter.Ver;
        Line(r,"지금 떠 있는 앱의 버전",fresh,
          (running==null?"옛 버전입니다(버전을 알리지 않습니다).":"실행 중 "+running+" / 지금 점검 "+Presenter.Ver)
          +(fresh?"":"\r\n           → 트레이에서 ‘앱 종료’ 후 Install.cmd 를 다시 실행하세요."));
        Line(r,"앱이 알려 온 상태",true,state);
      }

      // 여기가 갈림길이다. 확대가 안 되면 발표만 못 하고 핀은 된다.
      bool magInit=false,magMove=false;
      try{
        magInit=Native.MagInitialize();
        if(magInit){
          magMove=Native.MagSetFullscreenTransform(1.5f,0,0);
          Native.MagSetFullscreenTransform(1,0,0);
          Native.MagShowSystemCursor(true);
          Native.MagUninitialize();
        }
      }catch{}
      Line(r,"화면 확대 기능(발표)",magInit&&magMove,
        magInit&&magMove?"이 화면에서 확대가 됩니다."
        :(!magInit?"확대를 초기화하지 못했습니다."
                  :"확대 초기화는 됐지만 화면 전체 확대가 거부되었습니다.")
        +"\r\n           → 가상 머신(VMware 등)의 화면 드라이버는 이 기능을 지원하지 않는 경우가"
        +"\r\n              많습니다. 이때 발표(확대)는 못 하지만 화면 조각 핀은 정상입니다."
        +"\r\n              VMware 설정에서 3D 그래픽 가속을 켜면 되는 경우가 있습니다.");

      r.AppendLine(new string('-',58));
      r.AppendLine(magInit&&magMove
        ? "확대까지 됩니다. 발표·핀 모두 쓸 수 있어야 합니다."
        : "핀(화면 조각)은 쓸 수 있고, 발표(확대)만 이 화면에서 막힙니다.");
      string outPath=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"다있쌤-점검.txt");
      try{File.WriteAllText(outPath,r.ToString(),Encoding.UTF8);r.AppendLine();r.AppendLine("이 내용을 바탕화면 ‘다있쌤-점검.txt’ 에도 저장했습니다.");}catch{}
      MessageBox.Show(r.ToString(),"발표 도우미 점검");
    }
    [STAThread] public static void Main(string[] args){
      if(args.Length>0&&args[0].StartsWith("chrome-extension://",StringComparison.Ordinal)){NativeHost.Run(args);return;}
      // 어디서 막히는지 한 번에 알려 준다. VMware 같은 가상 화면에서는 확대 API 자체가
      // 없을 수 있는데, 그때도 핀은 되어야 한다. 둘을 따로 재서 원인을 갈라 준다.
      if(args.Length>0&&args[0]=="--check"){SelfCheck();return;}
      if(args.Length>0&&args[0]=="--reset"){if(Native.MagInitialize()){Native.MagSetFullscreenTransform(1,0,0);Native.MagShowSystemCursor(true);Native.MagUninitialize();}return;}
      if(args.Length>0&&args[0]=="--install"){
        string dir=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BrowserSheriff");Directory.CreateDirectory(dir);string target=Path.Combine(dir,"Presenter.exe");
        // 예전 앱이 떠 있으면 File.Copy 가 "다른 프로세스가 사용 중" 으로 터진다. 예전에는
        // 여기서 그대로 죽어, 등록만 새로 되고 실행 파일은 옛 것이 그대로 남았다. 그러면
        // 도크를 눌러도 명령 통로가 없는 옛 앱이 떠서 "아직 준비되지 않았습니다" 만 나온다.
        if(!String.Equals(Application.ExecutablePath,target,StringComparison.OrdinalIgnoreCase)){
          if(!Replace(target))return;
        }
        using(RegistryKey key=Registry.CurrentUser.CreateSubKey(@"Software\Classes\browsersheriff")){key.SetValue("","URL:Browser Sheriff Presenter");key.SetValue("URL Protocol","");using(RegistryKey command=key.CreateSubKey(@"shell\open\command")){command.SetValue("","\""+target+"\" \"%1\"");}}
        string manifestPath=Path.Combine(dir,"native-host.json");
        File.WriteAllText(manifestPath,JsonSerializer.Serialize(new{
          name=NativeHost.HostName,description="다있쌤 클립보드 도우미",path=target,type="stdio",
          allowed_origins=new[]{"chrome-extension://"+NativeHost.ExtensionID+"/"}}));
        using(RegistryKey key=Registry.CurrentUser.CreateSubKey(@"Software\Google\Chrome\NativeMessagingHosts\"+NativeHost.HostName)){key.SetValue("",manifestPath);}
        MessageBox.Show("설치했습니다 — 버전 "+Presenter.Ver+"\r\n\r\n"
          +"Chrome 을 다시 시작한 뒤 확장의 발표 탭에서 쓸 수 있습니다.\r\n"
          +"잘 안 되면 Check.cmd 를 실행해 어디서 막히는지 확인하세요.");return;
      }
      if(args.Length>0&&args[0]=="--uninstall"){
        using(RegistryKey key=Registry.CurrentUser.OpenSubKey(@"Software\Classes\browsersheriff\shell\open\command")){if(key!=null&&!Convert.ToString(key.GetValue("")).Contains(@"BrowserSheriff\Presenter.exe")){MessageBox.Show("다른 앱의 연결이므로 삭제하지 않았습니다.");return;}}
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Classes\browsersheriff",false);
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Google\Chrome\NativeMessagingHosts\"+NativeHost.HostName,false);
        try{File.Delete(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BrowserSheriff","native-host.json"));}catch{}
        MessageBox.Show("확장 연결과 클립보드 도우미 등록을 해제했습니다. 앱 파일과 바탕화면 캡처는 직접 삭제할 수 있습니다.");return;
      }
      bool quiet=args.Length>0&&args[0]=="--quiet";
      bool created;using(Mutex mutex=new Mutex(true,"Local\\BrowserSheriffPresenter",out created)){
        // --quiet 는 사이드바가 부른 것이다. 앱이 이미 떠 있으면 명령은 명령 이벤트로 따로
        // 가므로 조용히 물러난다. 여기서 Activate 를 울리면 누르지도 않은 발표가 시작된다.
        if(!created&&quiet)return;
        if(!created){try{using(EventWaitHandle signal=EventWaitHandle.OpenExisting("Local\\BrowserSheriffPresenterActivate")){signal.Set();}}catch(WaitHandleCannotBeOpenedException){MessageBox.Show("발표 도우미가 시작 중입니다. 트레이에서 발표 시작을 선택하세요.");}return;}
        bool startRequested=args.Length>0&&args[0].StartsWith("browsersheriff://presenter",StringComparison.OrdinalIgnoreCase);
        using(EventWaitHandle activation=new EventWaitHandle(false,EventResetMode.AutoReset,"Local\\BrowserSheriffPresenterActivate"))
        using(EventWaitHandle command=new EventWaitHandle(false,EventResetMode.AutoReset,Presenter.CommandEvent))
        using(EventWaitHandle recorder=new EventWaitHandle(false,EventResetMode.AutoReset,Presenter.RecorderEvent)){
          Native.SetProcessDpiAwarenessContext(new IntPtr(-4));Application.EnableVisualStyles();Application.SetCompatibleTextRenderingDefault(false);Application.Run(new Presenter(activation,command,recorder,startRequested,quiet));
        }
      }
    }
  }
}
