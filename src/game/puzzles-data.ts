/* 自动生成，勿手改。运行 npm run gen 重新生成。 */
export interface RawPuzzle {
  id: string
  name: string
  width: number
  height: number
  difficulty: 'easy' | 'medium' | 'hard' | 'custom'
  series: string
  /** 题面编码串（格式由 src/game/puzzles.ts 解析） */
  board: string
  /** 参考解编码串（没有则留空） */
  solution?: string
}

export const RAW_PUZZLES: RawPuzzle[] = [
  { id: "futoshiki-4x4-jijfnl", name: "初识不等式", width: 4, height: 4, difficulty: 'easy', series: "入门", board: "0030004002040420|210102001000200002012010", solution: "4132234132141423" },
  { id: "futoshiki-5x5-jijfnm", name: "五阶比较", width: 5, height: 5, difficulty: 'easy', series: "入门", board: "0201320000000000020000100|0120210112200010001202000112000200100200", solution: "5241321534453211324534152" },
  { id: "futoshiki-5x5-jijfnn", name: "大小回廊", width: 5, height: 5, difficulty: 'medium', series: "进阶", board: "0000000000000000000000000|0102100202102201012121102220010212022002", solution: "5134235421241534321512534" },
  { id: "futoshiki-6x6-jijfno", name: "六阶迷阵", width: 6, height: 6, difficulty: 'medium', series: "进阶", board: "005000450000010000020000000200200060|100000102101120200010001100202101221022100000221211211021212", solution: "365421456312512643621534143256234165" },
  { id: "futoshiki-6x6-jijfnp", name: "不等式之墙", width: 6, height: 6, difficulty: 'hard', series: "挑战", board: "002010001062260104500030005003326000|001200011202212010110012001000002200001021120101201122000010", solution: "632415451362263154514236145623326541" },
  { id: "futoshiki-6x6-jijfnq", name: "比较终局", width: 6, height: 6, difficulty: 'hard', series: "挑战", board: "000200000003400600000100000000004020|010111210221101200102101022002112100121101112210221002102200", solution: "145236261543423615532164316452654321" },
]
